#!/usr/bin/env python3
"""Verify phone-first, read-only project exploration on the Android emulator."""

from __future__ import annotations

import argparse
import importlib.util
import json
import sys
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
IMPORT_SMOKE = ROOT / "scripts" / "android-emulator-import-smoke.py"
spec = importlib.util.spec_from_file_location("android_import_smoke", IMPORT_SMOKE)
if spec is None or spec.loader is None:
    raise RuntimeError(f"Unable to load Android import helpers from {IMPORT_SMOKE}")
helpers = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = helpers
spec.loader.exec_module(helpers)


def matching_node(nodes: list[dict[str, str]], text: str) -> dict[str, str] | None:
    return next((node for node in nodes if text in node.get("text", "")), None)


def require_text(nodes: list[dict[str, str]], text: str, stage: str) -> dict[str, str]:
    node = matching_node(nodes, text)
    if node is None:
        visible = [node.get("text", "") for node in nodes if node.get("text")]
        raise RuntimeError(f"{stage}: Missing '{text}'; visible text={visible}")
    return node


def tap_text(nodes: list[dict[str, str]], text: str, stage: str) -> None:
    node = require_text(nodes, text, stage)
    bounds = node.get("bounds", "")
    if not bounds:
        raise RuntimeError(f"{stage}: '{text}' has no touch bounds")
    helpers.tap(helpers.center(bounds))


def wait_for_text(evidence: Path, text: str, stage: str, seconds: int = 20) -> list[dict[str, str]]:
    deadline = time.monotonic() + seconds
    last_nodes: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        try:
            last_nodes = helpers.dump_ui(evidence, stage)
        except (ET.ParseError, RuntimeError):
            time.sleep(1)
            continue
        if matching_node(last_nodes, text):
            return last_nodes
        time.sleep(1)
    require_text(last_nodes, text, stage)
    return last_nodes


def verify_navigation(nodes: list[dict[str, str]]) -> None:
    for label in ("Projects", "Maps", "Sprites", "Settings"):
        require_text(nodes, label, "phone navigation")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence-dir", type=Path)
    parser.add_argument("--package", default="com.essentialsstudio.mobile")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        sample = [{"text": name, "bounds": "[0,0][100,100]"}
                  for name in ("Projects", "Maps", "Sprites", "Settings")]
        verify_navigation(sample)
        require_text(sample, "Maps", "self-test")
        print("Android preview smoke self-test passed")
        return 0

    if args.evidence_dir is None:
        parser.error("--evidence-dir is required unless --self-test is used")
    evidence = args.evidence_dir
    evidence.mkdir(parents=True, exist_ok=True)

    helpers.adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
    helpers.adb("shell", "settings", "put", "system", "user_rotation", "0")
    time.sleep(3)

    nodes = wait_for_text(evidence, "Projects", "preview-projects")
    verify_navigation(nodes)
    if not helpers.editor_visible(nodes):
        raise RuntimeError("Preview smoke: imported project is not open in the editor")

    # Confirm that the Projects view contains the imported map and the preview
    # is explicitly read-only before exercising any editor controls.
    require_text(nodes, "Synthetic Map", "project map list")
    tap_text(nodes, "Maps", "open Maps section")
    nodes = wait_for_text(evidence, "Read-only map preview", "preview-map")
    require_text(nodes, "Synthetic Map", "preview map")
    tap_text(nodes, "Tools ▸", "open mobile tools")
    nodes = wait_for_text(evidence, "Tools ▾", "expanded read-only tools")
    if matching_node(nodes, "Pen") or matching_node(nodes, "Erase"):
        raise RuntimeError("Preview smoke: mutation tools are visible in read-only mode")

    # The experimental toggle is opt-in. Confirm its toolbar appears, then
    # immediately return to the safe preview state without saving any changes.
    tap_text(nodes, "Enable editing (experimental)", "enable experimental editing")
    nodes = wait_for_text(evidence, "Experimental editing enabled", "experimental-editing")
    tap_text(nodes, "Tools ▸", "open experimental tools")
    nodes = wait_for_text(evidence, "Tools ▾", "expanded experimental tools")
    require_text(nodes, "Pen", "experimental editing tools")
    tap_text(nodes, "Turn editing off", "return to read-only preview")
    nodes = wait_for_text(evidence, "Read-only map preview", "read-only-restored")

    tap_text(nodes, "Settings", "open Settings section")
    nodes = wait_for_text(evidence, "Preview settings", "preview-settings")
    require_text(nodes, "Save All (experimental)", "experimental warning")
    require_text(nodes, "Export ZIP (experimental)", "experimental warning")
    screenshot = subprocess.run(
        ["adb", "exec-out", "screencap", "-p"],
        capture_output=True,
        check=True,
    )
    (evidence / "preview-settings.png").write_bytes(screenshot.stdout)

    tap_text(nodes, "Sprites", "open Sprites section")
    nodes = wait_for_text(evidence, "Character Sprite Editor", "preview-sprites")
    tap_text(nodes, "Close", "close Sprite Editor")
    nodes = wait_for_text(evidence, "Settings", "return to phone navigation")
    verify_navigation(nodes)

    receipt = {
        "result": "passed",
        "checks": [
            "imported project opened",
            "Projects/Maps/Sprites/Settings navigation visible",
            "Sprite Editor opens and closes from phone navigation",
            "map browsing is read-only by default",
            "editing is explicitly opt-in and can be disabled",
            "Save All and ZIP export are labeled experimental",
        ],
    }
    (evidence / "preview-smoke-receipt.json").write_text(
        json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
    )
    print("Android preview import/navigation smoke passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
