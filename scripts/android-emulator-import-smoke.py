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


def wait_for(evidence: Path, name: str, needle: str, seconds: int) -> tuple[int, int]:
    deadline = time.monotonic() + seconds
    last_error = ""
    while time.monotonic() < deadline:
        try:
            point = locate(dump_ui(evidence, name), needle)
            if point:
                return point
        except (ET.ParseError, RuntimeError, subprocess.CalledProcessError) as exc:
            last_error = str(exc)
        time.sleep(3)
    raise RuntimeError(f"Missing Android UI item {needle!r}: {last_error}")


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
        tap(wait_for(evidence, "landing", "Import Essentials Project ZIP", 50))
        try:
            selected = wait_for(evidence, "picker", "EssentialsSynthetic.zip", 18)
        except RuntimeError:
            tap(wait_for(evidence, "picker-menu", "Show roots", 12))
            tap(wait_for(evidence, "picker-downloads", "Downloads", 15))
            selected = wait_for(evidence, "picker-file", "EssentialsSynthetic.zip", 25)
        tap(selected)
        wait_for(evidence, "imported", "Synthetic RMXP", 90)
        if not locate(dump_ui(evidence, "imported-final"), "Essentials Studio"):
            raise AssertionError("No editor window detected after import")
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
    options = parser.parse_args()
    if options.self_test:
        selftest()
        print("Accessibility selector self-tests passed")
        return 0
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
