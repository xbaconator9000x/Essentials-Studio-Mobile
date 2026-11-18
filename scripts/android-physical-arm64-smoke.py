#!/usr/bin/env python3
"""Direct, no-KVM ARM64 Android APK acceptance using the user's connected phone.

Requires Python 3 and Android SDK platform-tools (adb). Runs LOCALLY, not on a
GitHub runner: never uploads device screenshots, hierarchy, or personal data.
Never uninstalls/clears the app, changes system settings, or bypasses a
certificate mismatch. Not a substitute for editing/export/reimport acceptance.

Usage:
  python scripts/android-physical-arm64-smoke.py path/to/app-arm64.apk
  python scripts/android-physical-arm64-smoke.py path/to/app.apk --serial DEVICE_ID
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path

PACKAGE = "com.xbaconator.essentialsstudiomobile"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
EXPECTED_UI = ("Import Essentials Project ZIP", "Essentials Studio", "Projects", "Maps",
               "Sprites", "Settings", "Save all changes", "Project & export")


def choose_device(devices_output: str, requested: str | None) -> str:
    """Never silently pick the first of multiple devices or an offline device."""
    devices: dict[str, str] = {}
    for line in devices_output.splitlines():
        columns = line.split()
        if len(columns) >= 2 and not line.startswith("List of devices"):
            devices[columns[0]] = columns[1]
    if requested:
        if devices.get(requested) != "device":
            raise RuntimeError(f"Requested ADB device {requested!r} is not authorized/online: {devices}")
        return requested
    online = [serial for serial, state in devices.items() if state == "device"]
    if len(online) != 1:
        raise RuntimeError(f"Expected exactly one authorized ADB device, got {devices}; use --serial")
    return online[0]


def parse_ui(xml: bytes, package: str = PACKAGE) -> tuple[bool, list[str]]:
    """Require real app-owned accessibility elements, not an Android OS dialog."""
    start = xml.find(b"<?xml")
    if start < 0:
        raise RuntimeError("Android UIAutomator returned no XML")
    root = ET.fromstring(xml[start:])
    labels: list[str] = []
    owned = False
    for node in root.iter("node"):
        if node.get("package") != package:
            continue
        owned = True
        for key in ("text", "content-desc"):
            label = node.get(key, "").strip()
            if label:
                labels.append(label)
    return owned, labels


def ui_is_editor(owned: bool, labels: list[str]) -> bool:
    return owned and any(
        expected.casefold() in label.casefold()
        for label in labels for expected in EXPECTED_UI
    )


def check_png(data: bytes) -> tuple[int, int]:
    if len(data) < 24 or not data.startswith(PNG_SIGNATURE):
        raise RuntimeError("ADB screencap returned an invalid PNG")
    width = int.from_bytes(data[16:20], "big")
    height = int.from_bytes(data[20:24], "big")
    if width <= 0 or height <= 0:
        raise RuntimeError("ADB screencap has invalid dimensions")
    return width, height


def adb(serial: str, *args: str, timeout: int = 90, check: bool = True) -> bytes:
    response = subprocess.run(["adb", "-s", serial, *args],
                              capture_output=True, timeout=timeout, check=False)
    if check and response.returncode:
        detail = (response.stderr + response.stdout).decode(errors="replace")[-1000:]
        raise RuntimeError(f"ADB command {args[:3]!r} failed: {detail}")
    return response.stdout


def run(apk: Path, serial_arg: str | None, evidence: Path) -> dict[str, object]:
    if not apk.is_file() or apk.stat().st_size <= 0:
        raise RuntimeError(f"Missing or empty APK: {apk}")
    evidence.mkdir(parents=True, exist_ok=True)
    serial = choose_device(subprocess.run(
        ["adb", "devices", "-l"], capture_output=True, text=True, timeout=20,
        check=True,
    ).stdout, serial_arg)
    abi = adb(serial, "shell", "getprop", "ro.product.cpu.abilist").decode().strip()
    api = adb(serial, "shell", "getprop", "ro.build.version.sdk").decode().strip()
    if "arm64-v8a" not in abi.split(","):
        raise RuntimeError(f"Connected device is not ARM64: {abi}")
    if not api.isdigit():
        raise RuntimeError(f"Invalid device API level: {api!r}")
    digest = hashlib.sha256(apk.read_bytes()).hexdigest()
    receipt: dict[str, object] = {
        "apk_sha256": digest, "device_serial": serial, "device_abi": abi,
        "android_api": int(api), "package": PACKAGE,
        "verified": [], "not_verified": [
            "project import/edit/Save All/export/reimport",
            "RPG Maker XP/JoiPlay compatibility",
            "unattended physical-device testing without an ADB connection",
        ],
    }
    # Install over the existing app ONLY when Android allows it. Never remove
    # user data to bypass INSTALL_FAILED_UPDATE_INCOMPATIBLE.
    install = adb(serial, "install", "--no-streaming", "-r", "-t", str(apk.resolve()),
                  timeout=180)
    if b"Success" not in install:
        raise RuntimeError(f"ADB did not confirm install: {install.decode(errors='replace')[-500:]}")
    receipt["verified"].append("ARM64 APK installed without uninstalling the prior app")
    pm = adb(serial, "shell", "pm", "path", PACKAGE).decode()
    if "package:" not in pm:
        raise RuntimeError(f"Android did not register expected package {PACKAGE}")
    adb(serial, "shell", "am", "force-stop", PACKAGE)
    launched = adb(serial, "shell", "monkey", "-p", PACKAGE, "-c",
                   "android.intent.category.LAUNCHER", "1", timeout=50).decode()
    if "Events injected: 1" not in launched:
        raise RuntimeError(f"Android did not launch app: {launched[-500:]}")
    remote_xml = "/sdcard/essentials-direct-smoke.xml"
    owned = False
    labels: list[str] = []
    for attempt in range(12):
        time.sleep(3)
        pid = adb(serial, "shell", "pidof", PACKAGE, check=False).decode().strip()
        if not pid:
            continue
        dump = adb(serial, "shell", "uiautomator", "dump", remote_xml,
                   timeout=40, check=False)
        if b"dumped to" not in dump.lower() and b"xml" not in dump.lower():
            continue
        xml = adb(serial, "exec-out", "cat", remote_xml, timeout=20, check=False)
        try:
            owned, labels = parse_ui(xml)
        except (RuntimeError, ET.ParseError):
            continue
        if ui_is_editor(owned, labels):
            (evidence / "app-ui.xml").write_bytes(xml)
            receipt["verified"].append("live app-owned Android WebView accessibility UI")
            break
    else:
        raise RuntimeError("App did not expose recognizable UI; no launch success claimed")
    image = adb(serial, "exec-out", "screencap", "-p", timeout=40)
    width, height = check_png(image)
    (evidence / "live-app.png").write_bytes(image)
    receipt["screen"] = {"width": width, "height": height}
    receipt["verified"].append("actual ARM64 device screenshot captured")
    (evidence / "result.json").write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("apk", type=Path)
    parser.add_argument("--serial", help="Use exactly this ADB device serial")
    parser.add_argument("--evidence", type=Path, help="Local-only evidence folder")
    args = parser.parse_args()
    evidence = args.evidence or Path(
        "android-physical-evidence-" + datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S"))
    try:
        print(json.dumps(run(args.apk, args.serial, evidence), indent=2), flush=True)
        print("PASS: installed ARM64 APK, live app UI and screenshot; other workflows UNVERIFIED")
        return 0
    except (RuntimeError, OSError, subprocess.SubprocessError, ET.ParseError) as error:
        evidence.mkdir(parents=True, exist_ok=True)
        (evidence / "failure.txt").write_text(str(error) + "\n", encoding="utf-8")
        print(f"FAIL: {error}. Evidence: {evidence}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
