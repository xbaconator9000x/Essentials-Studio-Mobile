#!/usr/bin/env python3
"""Exercise the real Android sprite editor against a rights-cleared fixture."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import struct
import subprocess
import time
import zipfile
import zlib
from pathlib import Path

IMPORT_HELPER = Path(__file__).with_name("android-emulator-import-smoke.py")
spec = importlib.util.spec_from_file_location("android_import_helper", IMPORT_HELPER)
assert spec and spec.loader
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


def run_binary(*args: str) -> bytes:
    completed = subprocess.run(["adb", *args], capture_output=True, timeout=45)
    if completed.returncode:
        raise RuntimeError(
            f"adb {args[:3]!r} failed: {completed.stderr.decode(errors='replace')[-500:]}"
        )
    return completed.stdout


def locate_control(nodes: list[dict[str, str]], name: str) -> tuple[int, int] | None:
    for exact_match in (True, False):
        for node in nodes:
            label = " ".join((node.get("text", ""), node.get("content-desc", ""))).strip()
            matched = (
                label.casefold() == name.casefold()
                if exact_match
                else name.casefold() in label.casefold()
            )
            if not matched:
                continue
            try:
                return helper.center(node.get("bounds", ""))
            except ValueError:
                continue
    return None


def ui_control(nodes: list[dict[str, str]], name: str) -> dict[str, str] | None:
    for node in nodes:
        label = " ".join((node.get("text", ""), node.get("content-desc", ""))).strip()
        if name.casefold() in label.casefold() and locate_control([node], name):
            return node
    return None


def tap_control(nodes: list[dict[str, str]], name: str) -> None:
    point = locate_control(nodes, name)
    if not point:
        raise AssertionError(f"Missing visible Android sprite control: {name}")
    helper.tap(point)


def has_control(nodes: list[dict[str, str]], name: str) -> bool:
    return any(
        name.casefold() in " ".join(
            (node.get("text", ""), node.get("content-desc", ""))
        ).casefold()
        for node in nodes
    )


def save_mode_trigger(nodes: list[dict[str, str]]) -> tuple[int, int] | None:
    return (
        locate_control(nodes, "Save mode")
        or locate_control(nodes, "Save as copy (safe default)")
        or locate_control(nodes, "Replace original PNG")
    )


def sprite_controls_scroll_gesture(
    nodes: list[dict[str, str]],
    direction: str = "down",
) -> tuple[int, int, int, int] | None:
    if direction not in {"down", "up"}:
        raise ValueError(f"Unsupported sprite controls scroll direction: {direction}")
    for node in nodes:
        if node.get("resource-id") != "sprite-editor-controls" or node.get("scrollable") != "true":
            continue
        match = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
        if not match:
            continue
        left, top, right, bottom = map(int, match.groups())
        if right <= left or bottom - top < 160:
            continue
        x = (left + right) // 2
        if direction == "down":
            return x, bottom - 50, x, top + 50
        return x, top + 50, x, bottom - 50
    return None


def ensure_sprite_control_visible(
    nodes: list[dict[str, str]],
    name: str,
    evidence: Path,
    direction: str,
) -> list[dict[str, str]]:
    for attempt in range(6):
        if locate_control(nodes, name):
            return nodes
        gesture = sprite_controls_scroll_gesture(nodes, direction)
        if not gesture:
            raise AssertionError(
                f"{name} is offscreen and the sprite controls pane has no usable scroll bounds"
            )
        helper.adb(
            "shell", "input", "swipe", *(str(point) for point in gesture), "450"
        )
        nodes = helper.dump_ui(evidence, f"sprite-{name.lower().replace(' ', '-')}-scroll-{attempt + 1}")
    if not locate_control(nodes, name):
        raise AssertionError(f"{name} remained offscreen after scrolling sprite controls {direction}")
    return nodes


def screen_size() -> tuple[int, int]:
    output = helper.adb("shell", "wm", "size").stdout
    match = re.search(r"(?:Physical|Override) size:\s*(\d+)x(\d+)", output)
    if not match:
        raise AssertionError(f"Android did not report screen dimensions: {output.strip()!r}")
    return int(match.group(1)), int(match.group(2))


def open_sprite_editor(evidence: Path) -> list[dict[str, str]]:
    width, _ = screen_size()
    nodes = helper.dump_ui(evidence, "sprite-editor-entry")
    for attempt in range(5):
        control = ui_control(nodes, "Sprites")
        if control:
            x, y = helper.center(control["bounds"])
            if 0 <= x < width:
                helper.tap((x, y))
                helper.wait_for(evidence, "sprite-editor-open", "Character Sprite Editor", 20)
                return helper.dump_ui(evidence, "sprite-editor-open")
        helper.adb("shell", "input", "swipe", str(width - 8), "80", "8", "80", "350")
        nodes = helper.dump_ui(evidence, f"sprite-editor-entry-scroll-{attempt + 1}")
    raise AssertionError("Sprites action was not reachable in the Android project toolbar")


def close_sprite_editor(evidence: Path) -> None:
    nodes = helper.dump_ui(evidence, "sprite-before-close")
    if not has_control(nodes, "Character Sprite Editor"):
        raise AssertionError("Sprite Editor was not open after the saved-copy checks")
    tap_control(nodes, "Close")
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "sprite-after-close")
        if not has_control(nodes, "Character Sprite Editor"):
            if not locate_control(nodes, "Export ZIP..."):
                raise AssertionError("Project export control was not exposed after closing Sprite Editor")
            return
        time.sleep(1)
    raise AssertionError("Sprite Editor did not close after tapping its Close control")


def select_safe_copy_mode(nodes: list[dict[str, str]], evidence: Path) -> list[dict[str, str]]:
    trigger = save_mode_trigger(nodes)
    for attempt in range(6):
        if trigger:
            break
        gesture = sprite_controls_scroll_gesture(nodes)
        if not gesture:
            raise AssertionError(
                "Save mode selector is offscreen and the sprite controls pane has no usable scroll bounds"
            )
        helper.adb(
            "shell", "input", "swipe", *(str(point) for point in gesture), "450"
        )
        nodes = helper.dump_ui(evidence, f"sprite-save-mode-scroll-{attempt + 1}")
        trigger = save_mode_trigger(nodes)
    if not trigger:
        visible = [
            node.get("text", "") or node.get("content-desc", "")
            for node in nodes
            if node.get("text") or node.get("content-desc")
        ]
        raise AssertionError(
            "Save mode selector remained offscreen after scrolling sprite controls; "
            f"visible controls={visible[-20:]!r}"
        )
    helper.tap(trigger)
    options = helper.dump_ui(evidence, "sprite-save-mode-options")
    safe_copy = "Save as copy (safe default)"
    replace_original = "Replace original PNG"
    if not locate_control(options, safe_copy) or not locate_control(options, replace_original):
        visible = [
            node.get("text", "") or node.get("content-desc", "")
            for node in options
            if node.get("text") or node.get("content-desc")
        ]
        raise AssertionError(
            f"Save mode options were not exposed after opening selector: {visible[-20:]!r}"
        )
    tap_control(options, safe_copy)
    selected = helper.dump_ui(evidence, "sprite-save-mode-copy-selected")
    if not locate_control(selected, safe_copy) or not has_control(selected, "Copy name"):
        visible = [
            node.get("text", "") or node.get("content-desc", "")
            for node in selected
            if node.get("text") or node.get("content-desc")
        ]
        raise AssertionError(
            f"Safe copy mode was not selected with a copy-name field: {visible[-20:]!r}"
        )
    return selected


def private_sprite_path(package: str, stem: str) -> str:
    output = run_binary(
        "shell", "run-as", package, "find", ".", "-type", "f",
        "-path", f"*/Graphics/Characters/{stem}.png", "-print",
    ).decode(errors="replace")
    paths = [line.strip() for line in output.splitlines() if line.strip()]
    if len(paths) != 1 or not re.fullmatch(r"\./[A-Za-z0-9_./-]+", paths[0]):
        raise AssertionError(f"Expected one private sprite file for {stem}, found {paths!r}")
    if ".." in paths[0].split("/"):
        raise AssertionError("Unexpected traversal in private sprite path")
    return paths[0]


def png_rgba_rows(payload: bytes) -> tuple[int, int, list[bytearray]]:
    if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError("Saved sprite is not a PNG")
    offset = 8
    compressed = bytearray()
    width = height = bit_depth = color_type = interlace = 0
    while offset + 12 <= len(payload):
        length = struct.unpack_from(">I", payload, offset)[0]
        kind = payload[offset + 4:offset + 8]
        data = payload[offset + 8:offset + 8 + length]
        if offset + 12 + length > len(payload):
            raise AssertionError("Truncated PNG chunk")
        if kind == b"IHDR":
            width, height, bit_depth, color_type, _, _, interlace = struct.unpack(">IIBBBBB", data)
        elif kind == b"IDAT":
            compressed.extend(data)
        elif kind == b"IEND":
            break
        offset += length + 12
    if bit_depth != 8 or color_type != 6 or interlace != 0:
        raise AssertionError("Sprite PNG must use non-interlaced 8-bit RGBA pixels")
    raw = zlib.decompress(compressed)
    stride = width * 4
    rows: list[bytearray] = []
    previous = bytearray(stride)
    cursor = 0
    for _ in range(height):
        filter_type = raw[cursor]
        scanline = bytearray(raw[cursor + 1:cursor + 1 + stride])
        cursor += stride + 1
        for index in range(stride):
            left = scanline[index - 4] if index >= 4 else 0
            above = previous[index]
            upper_left = previous[index - 4] if index >= 4 else 0
            if filter_type == 1:
                scanline[index] = (scanline[index] + left) & 0xff
            elif filter_type == 2:
                scanline[index] = (scanline[index] + above) & 0xff
            elif filter_type == 3:
                scanline[index] = (scanline[index] + ((left + above) // 2)) & 0xff
            elif filter_type == 4:
                estimate = left + above - upper_left
                distances = (abs(estimate - left), abs(estimate - above), abs(estimate - upper_left))
                predictor = left if distances[0] <= distances[1] and distances[0] <= distances[2] else (
                    above if distances[1] <= distances[2] else upper_left
                )
                scanline[index] = (scanline[index] + predictor) & 0xff
            elif filter_type != 0:
                raise AssertionError(f"Unsupported PNG filter {filter_type}")
        rows.append(scanline)
        previous = scanline
    return width, height, rows


def png_pixel(payload: bytes, x: int, y: int) -> tuple[int, int, int, int]:
    width, height, rows = png_rgba_rows(payload)
    if not (0 <= x < width and 0 <= y < height):
        raise AssertionError(f"Requested sprite pixel outside {width}x{height}")
    start = x * 4
    return tuple(rows[y][start:start + 4])


def count_new_color_pixels(
    original: bytes,
    edited: bytes,
    color: tuple[int, int, int, int],
) -> int:
    original_width, original_height, original_rows = png_rgba_rows(original)
    edited_width, edited_height, edited_rows = png_rgba_rows(edited)
    if (original_width, original_height) != (edited_width, edited_height):
        raise AssertionError("Edited sprite dimensions differ from the original")
    return sum(
        tuple(edited_rows[y][offset:offset + 4]) == color
        and tuple(original_rows[y][offset:offset + 4]) != color
        for y in range(original_height)
        for offset in range(0, original_width * 4, 4)
    )


def original_fixture_sprite(fixture: Path) -> bytes:
    with zipfile.ZipFile(fixture) as archive:
        matches = [
            name for name in archive.namelist()
            if name.endswith("Graphics/Characters/SyntheticGuide.png")
        ]
        if len(matches) != 1:
            raise AssertionError(f"Expected one SyntheticGuide fixture, found {matches!r}")
        return archive.read(matches[0])


def smoke(package: str, evidence: Path, fixture: Path) -> None:
    evidence.mkdir(parents=True, exist_ok=True)
    receipt: dict[str, object] = {"result": "not_run"}
    try:
        original = original_fixture_sprite(fixture)
        original_center = png_pixel(original, 64, 64)
        if original_center[:3] == (230, 69, 83):
            raise AssertionError("Synthetic sprite already matches the selected paint color")

        nodes = open_sprite_editor(evidence)
        if not locate_control(nodes, "Brush (B)"):
            tap_control(nodes, "Tools")
            nodes = helper.dump_ui(evidence, "sprite-editor-controls-open")
        for control in ("Brush (B)", "Palette", "Undo", "Redo"):
            if not locate_control(nodes, control):
                visible = [
                    node.get("text", "") or node.get("content-desc", "")
                    for node in nodes
                    if node.get("text") or node.get("content-desc")
                ]
                raise AssertionError(
                    f"Sprite editor control was not exposed: {control}; "
                    f"visible controls={visible[-20:]!r}"
                )
        nodes = select_safe_copy_mode(nodes, evidence)
        tap_control(nodes, "Select #e64553")
        nodes = helper.dump_ui(evidence, "sprite-editor-color-selected")
        nodes = ensure_sprite_control_visible(nodes, "Fill (G)", evidence, "up")
        canvas_node = ui_control(nodes, "Sprite canvas")
        if not canvas_node:
            raise AssertionError("Accessible sprite canvas was not present in the UI hierarchy")
        canvas_x, canvas_y = helper.center(canvas_node["bounds"])
        tap_control(nodes, "Fill (G)")
        helper.tap((canvas_x, canvas_y))
        nodes = helper.dump_ui(evidence, "sprite-after-fill")
        if not has_control(nodes, "Unsaved pixel edits"):
            raise AssertionError("Touch fill did not mark sprite pixels dirty")
        tap_control(nodes, "Undo")
        nodes = helper.dump_ui(evidence, "sprite-after-undo")
        tap_control(nodes, "Redo")
        nodes = helper.dump_ui(evidence, "sprite-after-redo")
        tap_control(nodes, "Select #1e66f5")
        nodes = helper.dump_ui(evidence, "sprite-brush-color-selected")
        tap_control(nodes, "Brush (B)")
        canvas_node = ui_control(nodes, "Sprite canvas")
        if not canvas_node:
            raise AssertionError("Sprite canvas disappeared after tool changes")
        helper.tap(helper.center(canvas_node["bounds"]))
        time.sleep(1)
        (evidence / "sprite-after-paint.png").write_bytes(run_binary("exec-out", "screencap", "-p"))

        nodes = helper.dump_ui(evidence, "sprite-before-copy-save")
        tap_control(nodes, "Save sprite")
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            nodes = helper.dump_ui(evidence, "sprite-after-copy-save")
            if locate_control(nodes, "SyntheticGuide_copy") and not locate_control(nodes, "Unsaved pixel edits"):
                break
            if any("Sprite save failed" in node.get("text", "") for node in nodes):
                raise AssertionError("Sprite copy save reported a failure")
            time.sleep(1)
        else:
            raise AssertionError("Sprite copy save did not finish in the editor UI")

        original_path = private_sprite_path(package, "SyntheticGuide")
        original_saved_bytes = run_binary("exec-out", "run-as", package, "cat", original_path)
        if original_saved_bytes != original:
            raise AssertionError("Save-as-copy changed the original character graphic")

        copy_path = private_sprite_path(package, "SyntheticGuide_copy")
        saved = run_binary("exec-out", "run-as", package, "cat", copy_path)
        edited_pixel_count = count_new_color_pixels(
            original, saved, (30, 102, 245, 255)
        )
        if len(saved) < 64 or edited_pixel_count == 0:
            raise AssertionError(
                "Saved sprite has no new pixel matching the selected blue color"
            )
        if struct.unpack_from(">II", saved, 16) != (128, 128):
            raise AssertionError("Sprite editing changed the original 128x128 pixel dimensions")
        receipt.update({
            "result": "android_sprite_edit_copy_pass",
            "source_center_rgba": list(original_center),
            "saved_copy": copy_path,
            "saved_copy_sha256": hashlib.sha256(saved).hexdigest(),
            "new_blue_pixel_count": edited_pixel_count,
            "original_sha256_unchanged": hashlib.sha256(original_saved_bytes).hexdigest()
                == hashlib.sha256(original).hexdigest(),
            "source_dimensions": [128, 128],
            "save_mode": "copy",
        })
        close_sprite_editor(evidence)
    finally:
        (evidence / "sprite-edit-receipt.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )


def selftest() -> None:
    fixture_sprite = original_fixture_sprite_bytes()
    assert png_pixel(fixture_sprite, 0, 0) == (1, 2, 3, 255)
    assert png_pixel(fixture_sprite, 1, 0) == (4, 5, 6, 255)
    blue_edit = rgba_png_bytes(2, 1, bytes((30, 102, 245, 255, 4, 5, 6, 255)))
    assert count_new_color_pixels(fixture_sprite, blue_edit, (30, 102, 245, 255)) == 1
    assert count_new_color_pixels(fixture_sprite, fixture_sprite, (30, 102, 245, 255)) == 0
    assert locate_control([
        {"text": "Sprites", "bounds": "[0,0][0,0]"},
        {"text": "Sprites", "bounds": "[10,20][30,40]"},
    ], "Sprites") == (20, 30)
    assert locate_control([
        {"text": "Undo tile edit", "bounds": "[700,500][840,600]"},
        {"text": "Undo", "bounds": "[20,30][220,90]"},
    ], "Undo") == (120, 60)
    assert locate_control([{"text": "Sprites", "bounds": "[0,0][0,0]"}], "Sprites") is None
    assert locate_control([{"text": "Save mode", "bounds": "[10,20][30,40]"}],
                          "Save as copy (safe default)") is None
    assert locate_control([{"text": "Save as copy (safe default)", "bounds": "[10,20][30,40]"}],
                          "Save as copy (safe default)") == (20, 30)
    observed_hierarchy = [
        {"text": "Save mode", "bounds": ""},
        {
            "class": "android.widget.Spinner",
            "text": "Save as copy (safe default)",
            "bounds": "[0,0][0,0]",
        },
        {"text": "Copy name", "bounds": ""},
        {"text": "SyntheticGuide_copy", "bounds": "[100,260][300,310]"},
        {
            "resource-id": "sprite-editor-controls",
            "scrollable": "true",
            "bounds": "[0,149][635,1015]",
        },
    ]
    assert save_mode_trigger(observed_hierarchy) is None
    assert sprite_controls_scroll_gesture(observed_hierarchy) == (317, 965, 317, 199)
    assert sprite_controls_scroll_gesture(observed_hierarchy, "up") == (317, 199, 317, 965)
    assert has_control(observed_hierarchy, "Copy name")
    observed_hierarchy[1]["bounds"] = "[100,200][300,250]"
    assert save_mode_trigger(observed_hierarchy) == (200, 225)
    assert sprite_controls_scroll_gesture([
        {"resource-id": "sprite-editor-controls", "scrollable": "true", "bounds": "[0,0][0,0]"}
    ]) is None
    fill_offscreen_hierarchy = [
        {"text": "Fill (G)", "bounds": "[0,0][0,0]"},
        {
            "resource-id": "sprite-editor-controls",
            "scrollable": "true",
            "bounds": "[0,149][635,1015]",
        },
    ]
    assert locate_control(fill_offscreen_hierarchy, "Fill (G)") is None
    assert sprite_controls_scroll_gesture(fill_offscreen_hierarchy, "up") == (317, 199, 317, 965)
    dirty_status_hierarchy = [
        {"text": "Unsaved pixel edits", "bounds": "[0,0][0,0]"},
    ]
    assert has_control(dirty_status_hierarchy, "Unsaved pixel edits")
    assert locate_control(dirty_status_hierarchy, "Unsaved pixel edits") is None
    opened_options = [
        {"text": "Save as copy (safe default)", "bounds": "[10,20][210,70]"},
        {"text": "Replace original PNG", "bounds": "[10,70][210,120]"},
    ]
    assert locate_control(opened_options, "Save as copy (safe default)") == (110, 45)
    assert locate_control(opened_options, "Replace original PNG") == (110, 95)


def rgba_png_bytes(width: int, height: int, pixels: bytes) -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + kind + payload + struct.pack(
            ">I", zlib.crc32(kind + payload) & 0xffffffff
        )
    if len(pixels) != width * height * 4:
        raise ValueError("RGBA pixel data does not match image dimensions")
    header = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    stride = width * 4
    raw = b"".join(
        b"\x00" + pixels[y * stride:(y + 1) * stride]
        for y in range(height)
    )
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def original_fixture_sprite_bytes() -> bytes:
    return rgba_png_bytes(2, 1, bytes((1, 2, 3, 255, 4, 5, 6, 255)))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package")
    parser.add_argument("--evidence", type=Path)
    parser.add_argument("--fixture", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    try:
        if args.self_test:
            selftest()
            print("Android sprite smoke self-tests passed")
            return
        if not args.package or not args.evidence or not args.fixture:
            parser.error("--package, --evidence and --fixture are required")
        smoke(args.package, args.evidence, args.fixture)
    except Exception as exc:
        print(f"Android sprite editor NOT verified: {exc}")
        raise
    print("Android sprite edit/copy save verified with PNG pixel and dimension readback")


if __name__ == "__main__":
    main()
