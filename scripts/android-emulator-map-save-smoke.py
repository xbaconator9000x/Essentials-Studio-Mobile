#!/usr/bin/env python3
"""Real Android UI map-paint/save persistence gate, following the ZIP import smoke.

Runs only against a rights-cleared synthetic RMXP fixture on a debug emulator.
Never substitutes for physical ARM64 SAF export, desktop reopen or gameplay.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import struct
import subprocess
import time
from pathlib import Path

IMPORT_HELPER = Path(__file__).with_name("android-emulator-import-smoke.py")
spec = importlib.util.spec_from_file_location("android_import_helper", IMPORT_HELPER)
assert spec and spec.loader
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def run_adb(*args: str, timeout: int = 45) -> bytes:
    completed = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if completed.returncode:
        raise RuntimeError(
            f"adb {args[:3]!r} failed: {completed.stderr.decode(errors='replace')[-500:]}"
        )
    return completed.stdout


def bounds(text: str) -> tuple[int, int, int, int]:
    match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", text)
    if not match:
        raise ValueError(f"Invalid accessibility bounds: {text!r}")
    values = tuple(map(int, match.groups()))
    if values[2] <= values[0] or values[3] <= values[1]:
        raise ValueError(f"Empty accessibility bounds: {text!r}")
    return values


def find_named(nodes: list[dict[str, str]], name: str) -> dict[str, str]:
    for node in nodes:
        if node.get("text", "").strip() == name and node.get("bounds"):
            return node
    raise AssertionError(f"Missing Android UI control: {name}")


def private_map_path(package: str) -> str:
    # Pass find directly to run-as: adb shell flattens sh -c arguments, so
    # `sh -c find . -type f ...` executes bare `find` and lists every file.
    output = run_adb("shell", "run-as", package, "find", ".", "-type", "f",
                     "-name", "Map001.rxdata", "-print").decode(errors="replace")
    paths = [line.strip() for line in output.splitlines() if line.strip()]
    if len(paths) != 1 or not re.fullmatch(r"\./[A-Za-z0-9_./-]*Map001\.rxdata", paths[0]):
        raise AssertionError(f"Expected one app-private Map001.rxdata, found {paths!r}")
    if ".." in paths[0].split("/"):
        raise AssertionError("Unexpected traversal in app-private map path")
    return paths[0]


def read_private_map(package: str, path: str) -> bytes:
    payload = run_adb("exec-out", "run-as", package, "cat", path)
    if len(payload) < 64:
        raise AssertionError("App-private map is unexpectedly small")
    return payload


def status_has(nodes: list[dict[str, str]], layer: str, tile: str) -> bool:
    """WebView exposes adjacent status spans as separate accessibility nodes."""
    texts = {n.get("text", "").strip() for n in nodes}
    return layer in texts and tile in texts


def editor_images(nodes: list[dict[str, str]]) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """The left image is the map canvas; the right image is the tileset palette."""
    images = sorted(
        (bounds(n["bounds"]) for n in nodes
         if n.get("class") == "android.widget.Image" and n.get("bounds")),
        key=lambda rect: rect[0],
    )
    if len(images) != 2:
        raise AssertionError(f"Expected map canvas and tileset images, found {images!r}")
    canvas, palette = images
    if canvas[2] > palette[0] or canvas[2] - canvas[0] < 180:
        raise AssertionError(f"Map canvas collapsed or overlapping tileset: {images!r}")
    return canvas, palette


def paint_point(nodes: list[dict[str, str]], width: int, height: int) -> tuple[int, int]:
    """Touch the second map column inside the real map image, not the toolbar."""
    canvas, _ = editor_images(nodes)
    toolbar_bottom = max(bounds(find_named(nodes, name)["bounds"])[3]
                         for name in ("Pen", "L1", "L2", "L3", "Ev", "All"))
    x, y = canvas[0] + 110, canvas[1] + 40
    if not (canvas[0] < x < canvas[2] and max(toolbar_bottom, canvas[1]) < y
            < min(canvas[3], height - 80) and x < width):
        raise AssertionError(f"Paint point outside map canvas: {(x,y)}, {width}x{height}")
    return x, y


def palette_point(nodes: list[dict[str, str]], width: int, height: int) -> tuple[int, int]:
    """Select the second synthetic palette tile (385) before painting."""
    _, palette = editor_images(nodes)
    x, y = palette[0] + 120, palette[1] + 40
    if not (palette[0] < x < min(palette[2], width)
            and palette[1] < y < min(palette[3], height)):
        raise AssertionError(f"Palette target outside image: {(x, y)}, {width}x{height}")
    return x, y


def run(package: str, evidence: Path) -> None:
    receipt_path = evidence / "import-receipt.json"
    imported = json.loads(receipt_path.read_text(encoding="utf-8"))
    if imported.get("result") != "emulator_zip_import_open_pass":
        raise AssertionError("Cannot test map edit before actual Android ZIP import")
    receipt = {"source_sha": imported["source_sha"], "result": "failed"}
    try:
        path = private_map_path(package)
        before = read_private_map(package, path)
        receipt["map_path"] = path
        receipt["map_sha256_before"] = hashlib.sha256(before).hexdigest()

        run_adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
        run_adb("shell", "settings", "put", "system", "user_rotation", "1")
        time.sleep(5)
        image = run_adb("exec-out", "screencap", "-p")
        (evidence / "map-landscape-before.png").write_bytes(image)
        if not image.startswith(b"\x89PNG\r\n\x1a\n"):
            raise AssertionError("Android screenshot was not a PNG")
        width, height = struct.unpack(">II", image[16:24])
        receipt["landscape_pixels"] = [width, height]
        if width <= height:
            raise AssertionError(f"Android editor did not rotate to landscape: {width}x{height}")

        nodes = helper.dump_ui(evidence, "map-landscape-before")
        if not helper.editor_visible(nodes):
            raise AssertionError("Project editor disappeared after rotation")
        if not status_has(nodes, "Layer 1/3", "384"):
            raise AssertionError("Expected synthetic map layer 1 and selected tile 384")
        helper.tap(palette_point(nodes, width, height))
        time.sleep(2)
        nodes = helper.dump_ui(evidence, "map-after-palette-selection")
        if not status_has(nodes, "Layer 1/3", "385"):
            raise AssertionError("Second synthetic palette tile 385 was not selected")
        point = paint_point(nodes, width, height)
        receipt["paint_point"] = list(point)
        helper.tap(point)
        time.sleep(2)
        (evidence / "map-after-tap.png").write_bytes(run_adb("exec-out", "screencap", "-p"))
        nodes = helper.dump_ui(evidence, "map-after-tap")
        helper.tap(helper.wait_for(evidence, "map-save-control", "Save All", 12))
        time.sleep(5)
        nodes = helper.dump_ui(evidence, "map-after-save")
        if any("Save failed" in n.get("text", "") or "Error saving" in n.get("text", "")
               for n in nodes):
            raise AssertionError("Editor reported a map save failure")
        after = read_private_map(package, path)
        receipt["map_sha256_after"] = hashlib.sha256(after).hexdigest()
        if after == before:
            raise AssertionError("Map001.rxdata did not change after real touch paint and Save All")
        # Original input is an immutable ADB-pushed copy; UI edits must affect
        # only the extracted app-private map, never the source ZIP.
        source_hash = run_adb("shell", "sha256sum",
                              "/sdcard/Download/EssentialsSynthetic.zip").decode().split()[0]
        if source_hash != imported["fixture_sha256"]:
            raise AssertionError("Original imported ZIP changed during map edit")
        receipt["original_zip_unchanged"] = True
        receipt["result"] = "emulator_map_touch_save_pass"
    finally:
        (evidence / "map-edit-receipt.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )


def selftest() -> None:
    assert bounds("[10,20][100,120]") == (10, 20, 100, 120)
    for bad in ("[0,0][0,10]", "[10,10][1,20]", "nonsense"):
        try:
            bounds(bad)
        except ValueError:
            pass
        else:
            raise AssertionError(f"Accepted invalid bounds {bad}")
    # Regression: run-as must receive find directly, not sh -c with split arguments.
    original_run_adb = globals()["run_adb"]
    observed = []
    def fake_run_adb(*args: str, timeout: int = 45) -> bytes:
        observed.append(args)
        return b"./projects/import-test/Data/Map001.rxdata\n"
    try:
        globals()["run_adb"] = fake_run_adb
        assert private_map_path("com.example.fixture") == "./projects/import-test/Data/Map001.rxdata"
    finally:
        globals()["run_adb"] = original_run_adb
    assert observed == [("shell", "run-as", "com.example.fixture", "find", ".",
                         "-type", "f", "-name", "Map001.rxdata", "-print")]
    nodes = [
        {"text": "🗺 [001] Synthetic Map", "bounds": "[7,301][672,380]"},
        {"text": "", "class": "android.widget.Image", "bounds": "[679,315][1241,1018]"},
        {"text": "", "class": "android.widget.Image", "bounds": "[1241,354][1794,1039]"},
        *[{"text": name, "bounds": "[1399,217][1488,283]"}
          for name in ("Pen", "L1", "L2", "L3", "Ev", "All")],
        {"text": "Layer 1/3", "bounds": "[895,1031][1018,1068]"},
        {"text": "Tile: ", "bounds": "[1015,1031][1081,1068]"},
        {"text": "384", "bounds": "[1076,1031][1128,1068]"},
    ]
    assert status_has(nodes, "Layer 1/3", "384")
    assert not status_has(nodes, "Layer 1/3", "385")
    assert paint_point(nodes, 1794, 1080) == (789, 355)
    assert palette_point(nodes, 1794, 1080) == (1361, 394)
    nodes[1]["bounds"] = "[679,315][700,1018]"
    try:
        paint_point(nodes, 1794, 1080)
    except AssertionError as exc:
        assert "collapsed" in str(exc)
    else:
        raise AssertionError("Collapsed canvas incorrectly passed")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", default="com.xbaconator.essentialsstudiomobile")
    parser.add_argument("--evidence", type=Path, default=Path("android-runtime-evidence"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        selftest()
        print("Android map touch/save selector self-tests passed")
        return 0
    try:
        run(args.package, args.evidence)
    except Exception as exc:
        print(f"Android map edit/save NOT verified: {exc}")
        return 1
    print("Synthetic map touched and saved in Android emulator with SHA readback")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
