#!/usr/bin/env python3
"""Fail-closed Android emulator native UI smoke; no app data or private assets.

Runs on a free GitHub Actions x86_64 AVD against an actual Tauri Android APK.
Tests installation, first launch, accessibility, SAF picker, and portrait/
landscape relayout. This is not a physical ARM64 test or import/export gate.
"""
from __future__ import annotations

import hashlib
import importlib.util
import struct
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

EVIDENCE = Path(os.environ.get("ANDROID_EMULATOR_EVIDENCE", "android-emulator-evidence"))
EVIDENCE.mkdir(parents=True, exist_ok=True)
APK = Path(sys.argv[1]) if len(sys.argv) > 1 else None


def adb(*args: str, timeout: int = 45, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    response = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if check and response.returncode:
        raise RuntimeError(f"adb {args!r}: {response.returncode}: "
                           f"{response.stderr.decode(errors='replace')[-800:]}")
    return response


def screenshot(name: str) -> tuple[int, int]:
    data = adb("exec-out", "screencap", "-p", timeout=50).stdout
    if not data.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError(f"Android screenshot {name} was not a valid PNG")
    width, height = struct.unpack(">II", data[16:24])
    (EVIDENCE / f"{name}.png").write_bytes(data)
    return width, height


def ui_nodes(name: str) -> list[dict[str, str]]:
    remote = "/data/local/tmp/essentials-ci-hierarchy.xml"
    result = adb("shell", "uiautomator", "dump", remote, timeout=55, check=False)
    if result.returncode:
        raise RuntimeError(f"UIAutomator dump failed: {result.stderr.decode(errors='replace')[-600:]}")
    xml = adb("exec-out", "cat", remote, timeout=30).stdout
    start = xml.find(b"<?xml")
    if start < 0:
        raise RuntimeError("UIAutomator produced no XML document")
    xml = xml[start:]
    (EVIDENCE / f"{name}.xml").write_bytes(xml)
    root = ET.fromstring(xml)
    return [entry.attrib for entry in root.iter("node")]


def label(node: dict[str, str]) -> str:
    return " ".join((node.get("text", ""), node.get("content-desc", ""))).strip()


def locate(nodes: list[dict[str, str]], needle: str) -> tuple[int, int] | None:
    for item in nodes:
        if needle.casefold() not in label(item).casefold():
            continue
        found = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", item.get("bounds", ""))
        if found:
            x1, y1, x2, y2 = map(int, found.groups())
            if x2 > x1 and y2 > y1 and item.get("enabled") != "false":
                return ((x1 + x2) // 2, (y1 + y2) // 2)
    return None


def wait_ui(needle: str, name: str, timeout: int = 100) -> list[dict[str, str]]:
    deadline = time.monotonic() + timeout
    last_message = ""
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        try:
            nodes = ui_nodes(f"{name}-{attempt}")
            if locate(nodes, needle):
                return nodes
            last_message = str([label(n) for n in nodes if label(n)][-20:])
        except (RuntimeError, ET.ParseError) as error:
            last_message = str(error)
        time.sleep(3)
    raise AssertionError(f"Could not reach UI '{needle}' ({name}): {last_message}")


def action(nodes: list[dict[str, str]], name: str) -> tuple[int, int] | None:
    """Find an enabled, visible Android accessibility *button*, not a heading."""
    for item in nodes:
        if not item.get("class", "").endswith("Button"):
            continue
        if name.casefold() in label(item).casefold() and item.get("clickable") != "false":
            coords = locate([item], name)
            if coords:
                return coords
    return None


def tap(coords: tuple[int, int]) -> None:
    adb("shell", "input", "tap", str(coords[0]), str(coords[1]))


def tap_button(nodes: list[dict[str, str]], name: str) -> None:
    coords = action(nodes, name)
    if not coords:
        raise AssertionError(f"Missing accessible Android button {name!r}: "
                             f"{[label(n) for n in nodes if label(n)][-18:]!r}")
    tap(coords)


def assert_visible_controls(nodes: list[dict[str, str]], names: tuple[str, ...],
                            size: tuple[int, int]) -> None:
    """Fail when mobile buttons are off-screen after actual rotation."""
    width, height = size
    for name in names:
        point = action(nodes, name)
        if point is None:
            raise AssertionError(f"{name!r} not a visible touch button in {width}x{height}")
        if not (0 < point[0] < width and 0 < point[1] < height):
            raise AssertionError(f"{name!r} is outside {width}x{height}: {point}")


def rotate(landscape: bool, name: str, expected_ui: str) -> tuple[list[dict[str, str]], tuple[int, int]]:
    """Verify both native framebuffer orientation and fresh WebView controls."""
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
    adb("shell", "settings", "put", "system", "user_rotation", "1" if landscape else "0")
    deadline = time.monotonic() + 40
    size = (0, 0)
    while time.monotonic() < deadline:
        size = screenshot(name)
        if (size[0] > size[1]) == landscape:
            nodes = wait_ui(expected_ui, name, timeout=25)
            return nodes, size
        time.sleep(2)
    raise AssertionError(f"Native Android rotation did not settle for {name}: {size}")


def current_focus() -> str:
    return adb("shell", "dumpsys", "window", timeout=45).stdout.decode(errors="replace")


def focused_anr_owner(window_dump: str) -> str | None:
    """Read the foreground ANR dialog's process, never search the whole dump.

    The same dumpsys includes the editor's ResumedActivity even when a
    completely unrelated system launcher ANR is covering its window.
    """
    match = re.search(r"mFocusedWindow=[^\\n]*Application Not Responding:\\s*([\\w.]+)",
                      window_dump)
    return match.group(1) if match else None


def recover_pixel_launcher_anr() -> bool:
    """Tap Wait ONLY for the Android system Pixel Launcher, never our app."""
    try:
        nodes = ui_nodes("system-launcher-anr")
        title = " ".join(label(n) for n in nodes).casefold()
        if not any(phrase in title for phrase in (
            "pixel launcher isn't responding",
            "pixel launcher isn’t responding",
            "com.google.android.apps.nexuslauncher isn't responding",
            "com.google.android.apps.nexuslauncher isn’t responding",
        )):
            return False
        wait_control = next((n for n in nodes if label(n).strip().casefold() == "wait"
                             and locate([n], "Wait")), None)
        if wait_control is None:
            return False
        tap(locate([wait_control], "Wait"))
        print("Recovered unrelated Pixel Launcher ANR via its explicit Wait action.", flush=True)
        time.sleep(6)
        return True
    except (RuntimeError, ET.ParseError, subprocess.TimeoutExpired) as error:
        print(f"Could not recover Pixel Launcher ANR: {error}", flush=True)
        return False


def launch(package: str) -> None:
    output = adb("shell", "monkey", "-p", package, "-c",
                 "android.intent.category.LAUNCHER", "1", timeout=60).stdout
    (EVIDENCE / "launch-command.txt").write_bytes(output)
    print("Android monkey launcher:", output.decode(errors="replace")[-500:], flush=True)
    deadline = time.monotonic() + 110
    recovered = False
    while time.monotonic() < deadline:
        pid = adb("shell", "pidof", package, check=False).stdout.decode().strip()
        if pid:
            focus = current_focus()
            (EVIDENCE / "window-after-launch.txt").write_text(focus, encoding="utf-8")
            owner = focused_anr_owner(focus)
            if owner == package:
                raise AssertionError("Emulator reported a genuine Essentials Studio application ANR")
            if owner == "com.google.android.apps.nexuslauncher" and not recovered:
                recovered = recover_pixel_launcher_anr()
                if recovered:
                    continue
            if owner and owner != package:
                # An unrelated Android process can ANR under first-boot load,
                # but is not proof of editor failure or successful editor UI.
                print(f"Unrelated Android ANR: {owner}; awaiting app accessibility.", flush=True)
                time.sleep(3)
                continue
            print(f"Editor process started: PID={pid}; checking actual WebView UI.", flush=True)
            return
        time.sleep(2)
    raise AssertionError("Editor did not reach a usable Android foreground after launch")



def synthetic_project_ui(package: str, source: Path) -> dict[str, object]:
    """Exercise actual Android ZIP selection and editor workspace in BOTH modes."""
    expected_sha = "60c78b3171a0b4fc1dc96260cd8d8240374dc214dd282779f8ff49ade2c000bb"
    if not source.is_file():
        raise AssertionError("Rights-cleared project fixture was not produced by CI")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != expected_sha:
        raise AssertionError(f"Synthetic project ZIP SHA mismatch: {digest}")
    remote = "/sdcard/Download/EssentialsSynthetic.zip"
    adb("push", str(source), remote, timeout=90)
    actual_sha = adb("shell", "sha256sum", remote).stdout.decode().split()[0]
    if actual_sha != digest:
        raise AssertionError("Android ZIP transfer modified synthetic fixture bytes")
    # ADB-created files may require media indexing before appearing in Recents.
    adb("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
        "-d", f"file://{remote}", timeout=20, check=False)

    nodes = wait_ui("Import Essentials Project ZIP", "synthetic-import-entry")
    tap_button(nodes, "Choose Essentials Project ZIP")
    deadline = time.monotonic() + 45
    picker_nodes: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        picker_nodes = ui_nodes("synthetic-picker-entry")
        if any("documentsui" in node.get("package", "").casefold() for node in picker_nodes):
            break
        time.sleep(2)
    else:
        raise AssertionError("Primary ZIP File input did not open Android DocumentsUI")
    screenshot("synthetic-picker-entry")

    helper_path = Path(__file__).with_name("android-emulator-import-smoke.py")
    spec = importlib.util.spec_from_file_location("native_picker_helpers", helper_path)
    assert spec and spec.loader
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)

    # Prefer the exact DocumentsUI item and its clickable card, not an
    # unrelated text matching part of the filename or an arbitrary coordinate.
    selected = False
    for attempt in range(8):
        picker_nodes = ui_nodes(f"synthetic-picker-target-{attempt}")
        if not any("documentsui" in node.get("package", "").casefold()
                   for node in picker_nodes):
            break
        xml = (EVIDENCE / f"synthetic-picker-target-{attempt}.xml").read_text()
        card = helper.picker_file_card(xml, "EssentialsSynthetic.zip")
        if card:
            tap(card)
            time.sleep(4)
            selected = True
            continue
        list_toggle = helper.picker_list_view_control(picker_nodes)
        if list_toggle:
            tap(list_toggle)
            time.sleep(2)
            continue
        # Some document providers open in Recent, others in Downloads.
        folder = helper.picker_folder_row(xml, "Downloads") or helper.picker_folder_row(xml, "Download")
        if folder:
            tap(folder)
            time.sleep(2)
            continue
        download = locate(picker_nodes, "Downloads")
        if download:
            tap(download)
            time.sleep(2)
            continue
        roots = locate(picker_nodes, "Show roots") or locate(picker_nodes, "Browse")
        if roots:
            tap(roots)
            time.sleep(2)
            continue
        raise AssertionError("Cannot locate synthetic ZIP or Downloads in DocumentsUI: " +
                             repr([label(n) for n in picker_nodes if label(n)][-16:]))

    if not selected:
        raise AssertionError("DocumentsUI never selected the synthetic ZIP")
    project_nodes = wait_ui("maps available", "synthetic-project-loaded", timeout=100)
    if not any(item.get("package", "") == package for item in project_nodes):
        raise AssertionError("Project overview is not owned by the installed Android app")

    portrait = screenshot("portrait-project-overview")
    if portrait[0] >= portrait[1]:
        raise AssertionError(f"Project overview is not portrait: {portrait}")
    assert_visible_controls(project_nodes, ("Save all changes", "Export project ZIP",
                             "Projects", "Maps", "Sprites", "Settings"), portrait)

    # Select the actual rights-cleared map in the tree; inspect canvas and
    # palette on the full Android WebView before any UI state is reported passed.
    map_point = locate(project_nodes, "Synthetic Map")
    if not map_point:
        raise AssertionError("Synthetic map is missing from imported map tree")
    tap(map_point)
    map_nodes = wait_ui("Enable map editing", "portrait-map-editor", timeout=70)
    portrait_map = screenshot("portrait-map-editor")
    assert_visible_controls(map_nodes, ("Save all changes", "Export project ZIP",
                            "Choose another map", "Enable map editing", "Open tile palette"),
                            portrait_map)
    tap_button(map_nodes, "Open tile palette")
    tiles_nodes = wait_ui("Hide tile palette", "portrait-map-tiles", timeout=35)
    screenshot("portrait-map-tiles")
    tap_button(tiles_nodes, "Hide tile palette")

    # Rotate WHILE THE MAP is open, not merely on the start screen.
    landscape_nodes, landscape = rotate(True, "landscape-map-editor", "Enable map editing")
    assert_visible_controls(landscape_nodes, ("Save all changes", "Export project ZIP",
                            "Choose another map", "Enable map editing", "Open tile palette"),
                            landscape)
    screenshot("landscape-map-editor")
    tap_button(landscape_nodes, "Open tile palette")
    landscape_tiles = wait_ui("Hide tile palette", "landscape-map-tiles", timeout=35)
    screenshot("landscape-map-tiles")
    tap_button(landscape_tiles, "Hide tile palette")

    # The landscape screen must keep mobile navigation and the existing
    # desktop-backed database, scripts and PBS entrypoints usable.
    current = wait_ui("Settings", "landscape-nav", timeout=20)
    tap_button(current, "Settings")
    settings = wait_ui("Project & export", "landscape-settings", timeout=35)
    assert_visible_controls(settings, ("Save all changes", "Export project ZIP",
                            "Database", "Ruby Scripts", "PBS Data", "Sprite Editor"),
                            screenshot("landscape-settings"))
    portrait_settings, ps = rotate(False, "portrait-settings", "Project & export")
    assert_visible_controls(portrait_settings, ("Save all changes", "Export project ZIP",
                            "Database", "Ruby Scripts", "PBS Data", "Sprite Editor"), ps)
    assert_visible_controls(portrait_settings, ("Projects", "Maps", "Sprites", "Settings"), ps)
    tap_button(portrait_settings, "Maps")
    back_map = wait_ui("Enable map editing", "portrait-map-return", timeout=35)
    assert_visible_controls(back_map, ("Save all changes", "Export project ZIP"), screenshot("portrait-map-return"))
    return {
        "fixture_sha256": digest,
        "ui_checks": [
            "real synthetic RMXP ZIP selected with Android DocumentsUI",
            "project opened from original source ZIP", "portrait map canvas and tile drawer",
            "landscape map canvas and tile drawer", "landscape project data editor actions",
            "portrait project data editor actions", "map and toolbar survive rotation",
        ],
    }


def main() -> None:
    if not APK or not APK.is_file():
        raise RuntimeError("Pass the compiled x86_64 debug APK path")
    apk = APK.read_bytes()
    digest = hashlib.sha256(apk).hexdigest()
    aapt = sorted(Path(os.environ["ANDROID_HOME"]).glob("build-tools/*/aapt"))
    if not aapt:
        raise RuntimeError("Missing Android aapt build-tools")
    result = subprocess.run([str(aapt[-1]), "dump", "badging", str(APK)],
                            capture_output=True, text=True, check=True)
    matched = re.search(r"package: name='([^']+)'", result.stdout)
    if not matched:
        raise AssertionError("Built APK has no package ID")
    package = matched.group(1)

    abi = adb("shell", "getprop", "ro.product.cpu.abi").stdout.decode().strip()
    api = adb("shell", "getprop", "ro.build.version.sdk").stdout.decode().strip()
    if abi != "x86_64" or api != "35":
        raise AssertionError(f"Unexpected emulator device: ABI={abi}, API={api}")
    install = adb("install", "--no-streaming", "-r", str(APK), timeout=180)
    (EVIDENCE / "install.txt").write_bytes(install.stdout + install.stderr)
    if b"Success" not in install.stdout:
        raise AssertionError("ADB install did not confirm Success")
    package_path = adb("shell", "pm", "path", package).stdout.decode().strip()
    if not package_path.startswith("package:"):
        raise AssertionError("Package not registered after ADB install")

    launch(package)
    nodes = wait_ui("Import Essentials Project ZIP", "portrait-welcome")
    if not any(item.get("package", "") == package for item in nodes):
        raise AssertionError("Welcome control is not owned by the installed editor package")
    native_picker_label = "Use native Android document picker"
    assert_visible_controls(nodes, ("Choose Essentials Project ZIP", native_picker_label),
                            screenshot("portrait-welcome"))

    # The first orientation proof happens before fixture import. This
    # guarantees landscape evidence even if DocumentsUI import later fails.
    nodes, landscape_welcome = rotate(True, "landscape-welcome", "Import Essentials Project ZIP")
    assert_visible_controls(nodes, ("Choose Essentials Project ZIP", native_picker_label),
                            landscape_welcome)
    nodes, portrait_welcome = rotate(False, "portrait-welcome-return", "Import Essentials Project ZIP")
    assert_visible_controls(nodes, ("Choose Essentials Project ZIP", native_picker_label),
                            portrait_welcome)

    tap_button(nodes, native_picker_label)
    # The system document picker can appear under several Android package names.
    deadline = time.monotonic() + 60
    picker_found = False
    while time.monotonic() < deadline:
        nodes = ui_nodes("android-document-picker")
        if any("documentsui" in item.get("package", "").casefold() for item in nodes):
            picker_found = True
            break
        time.sleep(2)
    if not picker_found:
        raise AssertionError("Native Android DocumentsUI did not open")
    screenshot("native-document-picker")
    adb("shell", "input", "keyevent", "4")
    wait_ui("Import Essentials Project ZIP", "picker-return")

    nodes, portrait_size = rotate(False, "portrait-picker-return", "Import Essentials Project ZIP")
    assert_visible_controls(nodes, ("Choose Essentials Project ZIP", native_picker_label),
                            portrait_size)

    if len(sys.argv) < 3:
        raise AssertionError("Pass the rights-cleared synthetic RMXP fixture as the second argument")
    project_result = synthetic_project_ui(package, Path(sys.argv[2]))
    if not adb("shell", "pidof", package, check=False).stdout.strip():
        raise AssertionError("Application process exited during navigation")

    log = adb("logcat", "-d", "-v", "threadtime", timeout=60).stdout.decode(errors="replace")
    (EVIDENCE / "logcat.txt").write_text(log, encoding="utf-8")
    if any(f"ANR in {package}" in line for line in log.splitlines()):
        raise AssertionError("Android reported an editor ANR")
    if any("FATAL EXCEPTION" in line and package in "\n".join(log.splitlines()[i:i+15])
           for i, line in enumerate(log.splitlines())):
        raise AssertionError("Android reported a fatal exception in the editor")
    receipt = {
        "source_sha": os.environ.get("GITHUB_SHA", "unknown"),
        "test": "real Android x86_64 API35 native UI smoke",
        "package": package,
        "apk_sha256": digest,
        "emulator_api": int(api),
        "emulator_abi": abi,
        "checks": ["APK installed", "app-owned foreground WebView UI",
                   "portrait welcome accessibility", "landscape welcome accessibility",
                   "native SAF picker opened", "picker cancellation",
                   "synthetic Essentials ZIP imported through actual file picker",
                   "portrait and landscape map/tile UI", "portrait and landscape project editors",
                   "orientation roundtrip", "no detected editor ANR/crash"],
        "project_ui": project_result,
        "not_verified": ["ARM64 runtime", "physical Android",
                         "map/event/sprite content modification", "Save All/SAF ZIP export/reimport",
                         "RPG Maker XP desktop", "JoiPlay"],
    }
    (EVIDENCE / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2), flush=True)


if __name__ == "__main__":
    try:
        main()
    finally:
        try:
            (EVIDENCE / "final-logcat.txt").write_bytes(
                adb("logcat", "-d", "-v", "threadtime", timeout=45, check=False).stdout
            )
        except Exception:
            pass
        try:
            screenshot("final-screen")
        except Exception:
            pass
        # On failure, surface useful bounded diagnostics in CI in addition
        # to the full retained logcat and screenshot artifact. Never mistake
        # a Java/WebView crash for a UI selector timing issue.
        if sys.exc_info()[0] is not None:
            try:
                print("Android launcher output:", (EVIDENCE / "launch-command.txt").read_text(errors="replace")[-600:])
            except OSError:
                pass
            try:
                focus = adb("shell", "dumpsys", "activity", "activities", timeout=25,
                            check=False).stdout.decode(errors="replace")
                print("Android activities:", "\\n".join(
                    line for line in focus.splitlines()
                    if "Resumed" in line or "mFocused" in line or "essentials" in line.lower()
                )[-1500:], flush=True)
            except Exception as exc:
                print("Could not inspect resumed activity:", exc, flush=True)
