#!/usr/bin/env python3
"""Fail-closed real Android emulator ZIP-picker and project-open test.

Inputs must be the rights-cleared synthetic original.zip from native tests.
A passing test does not verify physical SAF export, desktop reopening or gameplay.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


def adb(*args: str, check: bool = True, timeout: int = 40) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["adb", *args], text=True, capture_output=True, check=check, timeout=timeout)


def entries(xml_text: str) -> list[dict[str, str]]:
    start = xml_text.find("<?xml")
    if start >= 0:
        xml_text = xml_text[start:]
    root = ET.fromstring(xml_text)
    return [n.attrib for n in root.iter("node")]


def center(value: str) -> tuple[int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", value)
    if not match:
        raise ValueError(f"Invalid accessibility bounds: {value!r}")
    left, top, right, bottom = map(int, match.groups())
    if right <= left or bottom <= top:
        raise ValueError("Empty accessibility bounds")
    return (left + right) // 2, (top + bottom) // 2


def locate(nodes: list[dict[str, str]], needle: str) -> tuple[int, int] | None:
    for node in nodes:
        text = node.get("text", "") + " " + node.get("content-desc", "")
        if needle.casefold() in text.casefold() and node.get("bounds"):
            return center(node["bounds"])
    return None


def dump_ui(evidence: Path, name: str) -> list[dict[str, str]]:
    result = adb("shell", "uiautomator", "dump", "/sdcard/window.xml", check=False, timeout=35)
    if result.returncode:
        raise RuntimeError("Cannot inspect UI: " + result.stderr[-350:])
    result = adb("exec-out", "cat", "/sdcard/window.xml")
    (evidence / f"{name}.xml").write_text(result.stdout, encoding="utf-8")
    return entries(result.stdout)


def reject_editor_anr(nodes: list[dict[str, str]]) -> None:
    """Fail closed on the editor's own Android ANR, not an OS system dialog."""
    if any("essentials studio mobile isn't responding" in n.get("text", "").casefold()
           for n in nodes):
        raise AssertionError("Editor application is not responding (ANR); import not exercised")


def wait_for(evidence: Path, name: str, needle: str, seconds: int) -> tuple[int, int]:
    deadline = time.monotonic() + seconds
    last_error = ""
    while time.monotonic() < deadline:
        try:
            nodes = dump_ui(evidence, name)
            reject_editor_anr(nodes)
            point = locate(nodes, needle)
            if point:
                return point
        except (ET.ParseError, RuntimeError, subprocess.CalledProcessError) as exc:
            last_error = str(exc)
        time.sleep(3)
    raise RuntimeError(f"Missing Android UI item {needle!r}: {last_error}")


def documents_ui_visible(nodes: list[dict[str, str]]) -> bool:
    """Verify the *native* document provider actually opened, not a WebView."""
    return any(
        n.get("package", "").startswith(("com.android.documentsui", "com.google.android.documentsui"))
        for n in nodes
    )


def wait_for_document_picker(evidence: Path, seconds: int) -> list[dict[str, str]]:
    deadline = time.monotonic() + seconds
    nodes: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        nodes = dump_ui(evidence, "after-import-tap")
        reject_editor_anr(nodes)
        if documents_ui_visible(nodes):
            return nodes
        time.sleep(2)
    visible = [n.get("text", "") for n in nodes if n.get("text")]
    raise RuntimeError(
        "Android DocumentsUI did not open after import control tap; "
        "native SAF picker is required if WebView file input is unsupported. "
        f"Visible UI: {visible[-12:]!r}"
    )


def picker_file_card(xml_text: str, filename: str) -> tuple[int, int] | None:
    """Tap the full DocumentsUI item, not its small nameplate or preview icon."""
    start = xml_text.find("<?xml")
    root = ET.fromstring(xml_text[start:] if start >= 0 else xml_text)
    for node in root.iter("node"):
        if node.get("resource-id") != "com.android.documentsui:id/item_root":
            continue
        if any(child.get("text", "").casefold() == filename.casefold()
               for child in node.iter("node")):
            return center(node.attrib["bounds"])
    return None


def editor_visible(nodes: list[dict[str, str]]) -> bool:
    """Require a loaded project, not merely the welcome screen or picker."""
    return (
        locate(nodes, "Essentials Studio —") is not None
        and locate(nodes, "Export ZIP") is not None
        and not any("Project ZIP import failed" in n.get("text", "") for n in nodes)
    )


def wait_for_editor(evidence: Path, seconds: int) -> bool:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            nodes = dump_ui(evidence, "after-picker")
            reject_editor_anr(nodes)
            if editor_visible(nodes):
                return True
            if any("Project ZIP import failed" in n.get("text", "") for n in nodes):
                return False
        except (ET.ParseError, RuntimeError, subprocess.CalledProcessError):
            pass
        time.sleep(3)
    return False


def tap(point: tuple[int, int]) -> None:
    adb("shell", "input", "tap", str(point[0]), str(point[1]))


def capture(evidence: Path) -> None:
    for name, args in (
        ("import-screen.png", ("exec-out", "screencap", "-p")),
        ("import-logcat.txt", ("logcat", "-d", "-v", "threadtime")),
        ("import-activities.txt", ("shell", "dumpsys", "activity", "activities")),
    ):
        try:
            result = subprocess.run(["adb", *args], capture_output=True, timeout=30, check=False)
            (evidence / name).write_bytes(result.stdout + (result.stderr if result.returncode else b""))
        except (OSError, subprocess.TimeoutExpired):
            pass



def system_anr_wait_button(nodes: list[dict[str, str]]) -> tuple[int, int] | None:
    """Only dismiss the OS process ANR's Wait button, never an app ANR."""
    labels = [n.get("text", "").strip().casefold() for n in nodes]
    if "process system isn't responding" not in labels:
        return None
    for node in nodes:
        if node.get("text", "").strip().casefold() == "wait" and node.get("bounds"):
            return center(node["bounds"])
    return None


def recover_system_anr(evidence: Path) -> bool:
    """Bounded, logged AOSP boot ANR recovery; never declare an import pass."""
    evidence.mkdir(parents=True, exist_ok=True)
    try:
        nodes = dump_ui(evidence, "system-anr")
        button = system_anr_wait_button(nodes)
        if button is None:
            return False
        tap(button)
        (evidence / "system-anr-recovery.txt").write_text(
            "Tapped Android OS process ANR Wait; editor focus still requires verification.\\n",
            encoding="utf-8",
        )
        return True
    except (RuntimeError, ET.ParseError, subprocess.CalledProcessError, subprocess.TimeoutExpired) as exc:
        (evidence / "system-anr-recovery.txt").write_text(
            "Could not safely dismiss OS ANR: " + str(exc)[:400] + "\\n",
            encoding="utf-8",
        )
        return False


def smoke(fixture: Path, evidence: Path, package: str) -> None:
    if not fixture.is_file() or fixture.stat().st_size == 0:
        raise FileNotFoundError("Native-generated synthetic original.zip is required")
    evidence.mkdir(parents=True, exist_ok=True)
    remote = "/sdcard/Download/EssentialsSynthetic.zip"
    original_hash = hashlib.sha256(fixture.read_bytes()).hexdigest()
    adb("shell", "mkdir", "-p", "/sdcard/Download")
    adb("push", str(fixture), remote, timeout=90)
    copied_hash = adb("shell", "sha256sum", remote).stdout.split()[0]
    if copied_hash != original_hash:
        raise AssertionError("Fixture changed during ADB transfer")
    adb("shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE",
        "-d", f"file://{remote}", check=False)
    receipt: dict[str, object] = {
        "source_sha": __import__("os").environ.get("GITHUB_SHA", "local"),
        "fixture_sha256": original_hash, "package": package, "result": "failed"
    }
    try:
        # Tap the actual input's accessibility button, not the surrounding
        # label text; assert that a native picker launches before looking for
        # a file. A missing picker is an app integration defect, not a missing
        # "Show roots" menu item.
        tap(wait_for(evidence, "landing", "Choose Essentials Project ZIP", 50))
        wait_for_document_picker(evidence, 15)
        try:
            selected = wait_for(evidence, "picker", "EssentialsSynthetic.zip", 18)
        except RuntimeError:
            tap(wait_for(evidence, "picker-menu", "Show roots", 12))
            tap(wait_for(evidence, "picker-downloads", "Downloads", 15))
            selected = wait_for(evidence, "picker-file", "EssentialsSynthetic.zip", 25)
        # A file may appear under Recent without opening Downloads; capture
        # the current picker hierarchy for either path before selecting it.
        dump_ui(evidence, "picker-file")
        # DocumentsUI grid tiles can require a tap on the card rather than
        # the title/nameplate. The previous test spent 90s waiting for an
        # impossible marker while still displaying the system file picker.
        xml = (evidence / "picker-file.xml").read_text(encoding="utf-8")
        card = picker_file_card(xml, "EssentialsSynthetic.zip")
        if card is None:
            raise AssertionError("Cannot locate the synthetic ZIP picker card")
        tap(card)
        if not wait_for_editor(evidence, 35):
            # Preserve a real failure when the picker stays open or import
            # rejects the ZIP; never count a live WebView as successful import.
            nodes = dump_ui(evidence, "import-attempt-final")
            visible = [n.get("text", "") for n in nodes if n.get("text")]
            raise AssertionError("Project did not open after DocumentsUI selection: " + repr(visible[-16:]))
        nodes = dump_ui(evidence, "imported-final")
        if not editor_visible(nodes):
            raise AssertionError("Project editor controls not visible after ZIP import")
        pid = adb("shell", "pidof", package, check=False).stdout.strip()
        if not pid:
            raise AssertionError("Editor process crashed during project import")
        receipt.update({"result": "emulator_zip_import_open_pass", "process": pid})
    finally:
        (evidence / "import-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        capture(evidence)


def selftest() -> None:
    xml = '<?xml version="1.0"?><hierarchy><node text="" bounds="[0,0][100,100]"><node text="Import Essentials Project ZIP" bounds="[10,20][90,60]"/></node></hierarchy>'
    assert locate(entries(xml), "Import Essentials Project ZIP") == (50, 40)
    assert locate(entries(xml), "missing") is None
    picker_xml = '<?xml version="1.0"?><hierarchy><node resource-id="com.android.documentsui:id/item_root" bounds="[10,20][110,220]"><node text="EssentialsSynthetic.zip"/></node></hierarchy>'
    assert picker_file_card(picker_xml, "EssentialsSynthetic.zip") == (60, 120)
    assert picker_file_card(picker_xml, "other.zip") is None
    assert not editor_visible(entries(xml))
    assert not documents_ui_visible(entries(xml))
    picker_visible_xml = ('<?xml version="1.0"?><hierarchy>'
                          '<node package="com.android.documentsui" text="Recent" bounds="[0,0][200,80]"/>'
                          '</hierarchy>')
    assert documents_ui_visible(entries(picker_visible_xml))
    editor_xml = '<?xml version="1.0"?><hierarchy><node text="Essentials Studio — Project" bounds="[0,0][400,60]"/><node text="Export ZIP..." bounds="[0,70][400,140]"/></hierarchy>'
    assert editor_visible(entries(editor_xml))
    app_anr = ('<?xml version="1.0"?><hierarchy>'
               '<node text="Essentials Studio Mobile isn\'t responding" bounds="[0,0][80,60]"/>'
               '</hierarchy>')
    try:
        reject_editor_anr(entries(app_anr))
    except AssertionError:
        pass
    else:
        raise AssertionError("The emulator must reject editor ANR dialogs")

    anr_xml = ('<?xml version="1.0"?><hierarchy>'
               '<node text="Process system isn\'t responding" bounds="[0,0][100,30]"/>'
               '<node text="Close app" bounds="[10,30][90,50]"/>'
               '<node text="Wait" bounds="[10,60][90,100]"/></hierarchy>')
    assert system_anr_wait_button(entries(anr_xml)) == (50, 80)
    assert system_anr_wait_button(entries(editor_xml)) is None
    assert system_anr_wait_button(entries(anr_xml.replace("system", "Essentials Studio"))) is None
    try:
        center("[0,0][0,10]")
    except ValueError:
        pass
    else:
        raise AssertionError("Empty bounds accepted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--package")
    parser.add_argument("--evidence", type=Path, default=Path("android-runtime-evidence"))
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--recover-system-anr", action="store_true")
    options = parser.parse_args()
    if options.self_test:
        selftest()
        print("Accessibility selector self-tests passed")
        return 0
    if options.recover_system_anr:
        return 0 if recover_system_anr(options.evidence) else 1
    if not options.fixture or not options.package:
        parser.error("--fixture and --package are required")
    try:
        smoke(options.fixture, options.evidence, options.package)
    except Exception as exc:
        print(f"Android emulator import NOT verified: {exc}")
        return 1
    print("Synthetic ZIP imported and opened on Android emulator")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
