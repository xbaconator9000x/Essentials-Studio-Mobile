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


def matching_button(nodes: list[dict[str, str]], text: str) -> dict[str, str] | None:
    return next(
        (node for node in nodes
         if node.get("text") == text
         and node.get("class", "").endswith("Button")
         and node.get("clickable") == "true"
         and node.get("enabled") != "false"
         and has_touch_bounds(node)),
        None,
    )


def matching_tappable_node(nodes: list[dict[str, str]], text: str) -> dict[str, str] | None:
    return next(
        (node for node in nodes
         if text in node.get("text", "")
         and node.get("clickable") == "true"
         and node.get("enabled") != "false"
         and has_touch_bounds(node)),
        None,
    )


def has_touch_bounds(node: dict[str, str]) -> bool:
    try:
        helpers.center(node.get("bounds", ""))
    except ValueError:
        return False
    return True


def require_text(nodes: list[dict[str, str]], text: str, stage: str) -> dict[str, str]:
    node = matching_node(nodes, text)
    if node is None:
        visible = [node.get("text", "") for node in nodes if node.get("text")]
        raise RuntimeError(f"{stage}: Missing '{text}'; visible text={visible}")
    return node


def tap_text(nodes: list[dict[str, str]], text: str, stage: str) -> None:
    node = matching_tappable_node(nodes, text)
    if node is None:
        raise RuntimeError(f"{stage}: No visible, clickable target for '{text}'")
    helpers.tap(helpers.center(node["bounds"]))


def tap_button(nodes: list[dict[str, str]], text: str, stage: str) -> None:
    node = matching_button(nodes, text)
    if node is None:
        raise RuntimeError(f"{stage}: Missing visible, clickable button '{text}'")
    helpers.tap(helpers.center(node["bounds"]))


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
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        sample = [{"text": name, "bounds": "[0,0][100,100]"}
                  for name in ("Projects", "Maps", "Sprites", "Settings",
                               "Read-only preview", "Map [001] 2x2 Layer 1/3")]
        sample.insert(0, {"text": "Maps", "class": "android.widget.TextView",
                          "clickable": "false", "bounds": "[0,0][50,50]"})
        sample.append({"text": "Maps", "class": "android.widget.Button",
                       "clickable": "true", "enabled": "true",
                       "bounds": "[100,100][200,200]"})
        sample.insert(1, {"text": "Maps", "class": "android.widget.Button",
                           "clickable": "true", "enabled": "true",
                           "bounds": "[0,0][0,0]"})
        verify_navigation(sample)
        require_text(sample, "Maps", "self-test")
        if matching_button(sample, "Maps") is not sample[-1]:
            raise AssertionError("Maps selection must skip a hidden button")
        tappable_map = {"text": "🗺 [001] Synthetic Map",
                        "clickable": "true", "enabled": "true",
                        "bounds": "[7,735][1073,863]"}
        sample.append(tappable_map)
        if matching_tappable_node(sample, "Synthetic Map") is not tappable_map:
            raise AssertionError("Map selection must use the visible clickable map row")
        if matching_tappable_node(sample, "Read-only preview") is not None:
            raise AssertionError("A non-clickable text label must not be used as a tap target")
        hidden_button = {"text": "Hidden", "class": "android.widget.Button",
                         "clickable": "true", "enabled": "true",
                         "bounds": "[0,0][0,0]"}
        if matching_button([hidden_button], "Hidden") is not None:
            raise AssertionError("A zero-sized hidden button must not be selected")
        require_text(sample, "Read-only preview", "self-test")
        require_text(sample, "Map [001]", "self-test map content")
        print("Android preview smoke self-test passed")
        return 0

    if args.evidence_dir is None:
        parser.error("--evidence-dir is required unless --self-test is used")
    evidence = args.evidence_dir
    evidence.mkdir(parents=True, exist_ok=True)

    previous_accelerometer_rotation = helpers.adb(
        "shell", "settings", "get", "system", "accelerometer_rotation"
    ).stdout.strip()
    previous_user_rotation = helpers.adb(
        "shell", "settings", "get", "system", "user_rotation"
    ).stdout.strip()
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
    tap_text(nodes, "Synthetic Map", "open imported map")
    nodes = wait_for_text(evidence, "Read-only preview", "preview-map")
    require_text(nodes, "Map [001]", "visible map content")
    tap_text(nodes, "Tools ▸", "open mobile tools")
    nodes = wait_for_text(evidence, "Tools ▾", "expanded read-only tools")
    if matching_node(nodes, "Pen") or matching_node(nodes, "Erase"):
        raise RuntimeError("Preview smoke: mutation tools are visible in read-only mode")

    # The experimental toggle is opt-in. Confirm its toolbar appears, then
    # immediately return to the safe preview state without saving any changes.
    tap_text(nodes, "Enable editing (experimental)", "enable experimental editing")
    nodes = wait_for_text(evidence, "Experimental editing enabled", "experimental-editing")
    require_text(nodes, "Pen", "experimental editing tools")
    tap_text(nodes, "Turn editing off", "return to read-only preview")
    nodes = wait_for_text(evidence, "Read-only preview", "read-only-restored")

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
    nodes = wait_for_text(evidence, "Sprite tools", "preview-sprites")
    require_text(nodes, "Open Sprite Editor (experimental)", "sprite edit opt-in")
    require_text(nodes, "Sprite changes are experimental", "sprite safety warning")
    if matching_node(nodes, "Character Sprite Editor"):
        raise RuntimeError("Preview smoke: Sprite Editor opened without opt-in")
    tap_text(nodes, "Open Sprite Editor (experimental)", "open experimental Sprite Editor")
    nodes = wait_for_text(evidence, "Character Sprite Editor", "experimental-sprites")
    tap_text(nodes, "Close", "close Sprite Editor")
    nodes = wait_for_text(evidence, "Sprite tools", "return to sprite preview")
    verify_navigation(nodes)

    helpers.adb(
        "shell", "settings", "put", "system", "user_rotation", previous_user_rotation
    )
    helpers.adb(
        "shell", "settings", "put", "system", "accelerometer_rotation",
        previous_accelerometer_rotation,
    )
    time.sleep(3)

    receipt = {
        "result": "passed",
        "checks": [
            "imported project opened",
            "Projects/Maps/Sprites/Settings navigation visible",
            "Sprite Editor opens only after explicit experimental opt-in",
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
