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


def launch(package: str) -> None:
    output = adb("shell", "monkey", "-p", package, "-c",
                 "android.intent.category.LAUNCHER", "1", timeout=60).stdout
    (EVIDENCE / "launch-command.txt").write_bytes(output)
    print("Android monkey launcher:", output.decode(errors="replace")[-500:], flush=True)
    # Android 15's dumpsys window output is not a stable public API: its
    # focus strings differ from prior emulator releases. Require a real
    # app process here, then prove actual foreground *UI* via fresh
    # UIAutomator nodes below, rather than failing on a missing focus token.
    deadline = time.monotonic() + 90
    while time.monotonic() < deadline:
        pid = adb("shell", "pidof", package, check=False).stdout.decode().strip()
        if pid:
            focus = current_focus()
            (EVIDENCE / "window-after-launch.txt").write_text(focus, encoding="utf-8")
            if "Application Not Responding" in focus and package in focus:
                raise AssertionError("Emulator reported an editor application ANR on launch")
            print(f"Editor process started: PID={pid}", flush=True)
            return
        time.sleep(2)
    raise AssertionError("Editor process never started after launcher intent")


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
        "checks": ["APK installed", "foreground WebView UI", "ZIP import affordance",
                   "native SAF picker opened", "picker cancellation",
                   "landscape relayout", "portrait return", "no detected editor ANR/crash"],
        "not_verified": ["ARM64 runtime", "physical Android", "ZIP import/save/export/reimport",
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
