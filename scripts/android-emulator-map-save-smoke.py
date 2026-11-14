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
import os
import re
import struct
import subprocess
import tempfile
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
        detail = (completed.stdout + b"\n" + completed.stderr).decode(
            errors="replace"
        ).strip()
        raise RuntimeError(
            f"adb {args[:3]!r} failed with exit code {completed.returncode}: "
            f"{detail[-500:]}"
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


def usable_bounds(text: str) -> tuple[int, int, int, int] | None:
    try:
        return bounds(text)
    except ValueError:
        return None


def find_named(nodes: list[dict[str, str]], name: str) -> dict[str, str]:
    for node in nodes:
        if (node.get("text", "").strip() == name
                and usable_bounds(node.get("bounds", ""))):
            return node
    for node in nodes:
        description = node.get("content-desc", "").strip()
        if ((description == name or description.startswith(f"{name} "))
                and usable_bounds(node.get("bounds", ""))):
            return node
    raise AssertionError(f"Missing Android UI control: {name}")


def find_button(nodes: list[dict[str, str]], name: str) -> dict[str, str] | None:
    return next((
        node for node in nodes
        if node.get("text", "").strip() == name
        and node.get("class") == "android.widget.Button"
        and node.get("clickable") == "true"
        and usable_bounds(node.get("bounds", ""))
    ), None)


def focused_dialogue_field(nodes: list[dict[str, str]]) -> dict[str, str] | None:
    return next((
        node for node in nodes
        if (
            "EditText" in node.get("class", "")
            or "dialogue lines" in node.get("content-desc", "").lower()
        )
        and node.get("focused") == "true"
        and usable_bounds(node.get("bounds", ""))
    ), None)


def visible_dialogue_editor(nodes: list[dict[str, str]], original: str) -> dict[str, str] | None:
    return next((
        node for node in nodes
        if usable_bounds(node.get("bounds", ""))
        and (
            (
                "EditText" in node.get("class", "")
                and original in node.get("text", "")
            )
            or "dialogue lines" in node.get("content-desc", "").lower()
        )
    ), None)


def tap_named(nodes: list[dict[str, str]], name: str) -> None:
    helper.tap(helper.center(find_named(nodes, name)["bounds"]))


def map_editor_visible(nodes: list[dict[str, str]]) -> bool:
    if any(find_button(nodes, layer) is None for layer in ("L1", "L2", "L3", "Ev")):
        return False
    return len([
        node for node in nodes
        if node.get("class") == "android.widget.Image"
        and usable_bounds(node.get("bounds", ""))
    ]) == 2


def wait_for_restarted_map(evidence: Path) -> tuple[list[dict[str, str]], int, int]:
    nodes = helper.dump_ui(evidence, "restart-project-open")
    if not map_editor_visible(nodes):
        # A fresh Android process restores the project in its portrait Projects
        # overview. Enter Maps through the bounded navigation button, not the
        # similarly named static section heading.
        maps_button = find_button(nodes, "Maps")
        if maps_button is None:
            raise AssertionError(
                "Reopened project showed neither map editor controls nor a "
                "touchable Maps navigation button"
            )
        helper.tap(helper.center(maps_button["bounds"]))

    run_adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
    run_adb("shell", "settings", "put", "system", "user_rotation", "1")
    deadline = time.monotonic() + 30
    last_size = (0, 0)
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "restart-map-editor")
        screenshot = run_adb("exec-out", "screencap", "-p")
        if screenshot.startswith(b"\x89PNG\r\n\x1a\n"):
            last_size = struct.unpack(">II", screenshot[16:24])
            if last_size[0] > last_size[1] and map_editor_visible(nodes):
                (evidence / "restart-map-editor.png").write_bytes(screenshot)
                return nodes, *last_size
        time.sleep(1)
    visible = [node.get("text", "") for node in nodes if node.get("text")]
    raise AssertionError(
        f"Reopened project did not reach the landscape map editor; "
        f"screen={last_size!r}, visible text={visible[-16:]!r}"
    )


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
    """Match split WebView status spans by row and adjacency, not global text."""
    layer_nodes = [n for n in nodes if n.get("text", "").strip() == layer]
    labels = [n for n in nodes if n.get("text", "").strip() == "Tile:"]
    values = [n for n in nodes if n.get("text", "").strip() == tile]
    for layer_node in layer_nodes:
        for label in labels:
            for value in values:
                rects = [usable_bounds(n.get("bounds", "")) for n in (layer_node, label, value)]
                if any(rect is None for rect in rects):
                    continue
                _, ly1, lx2, ly2 = rects[0]
                tx1, ty1, tx2, ty2 = rects[1]
                vx1, vy1, vx2, vy2 = rects[2]
                if (max(ly1, ty1, vy1) < min(ly2, ty2, vy2)
                        and -15 <= tx1 - lx2 <= 50
                        and -15 <= vx1 - tx2 <= 50):
                    return True
    return False


def status_visible(nodes: list[dict[str, str]], status: str) -> bool:
    return any(
        node.get("text", "").strip() == status
        and usable_bounds(node.get("bounds", ""))
        for node in nodes
    )


def save_all_success_visible(nodes: list[dict[str, str]]) -> bool:
    return any(
        "All registered editor changes were saved to the working project."
        in node.get("text", "")
        and usable_bounds(node.get("bounds", "")) is not None
        for node in nodes
    )


def save_all_completed_in_log(log: str) -> bool:
    lock = log.rfind("[save-all] operation lock acquired")
    native_save = log.find("[save-all] native map save completed", lock)
    operation = log.find("[save-all] operation completed", native_save)
    reset = log.find("[save-all] toolbar state saving=false", operation)
    return lock >= 0 and lock < native_save < operation < reset


def editor_images(nodes: list[dict[str, str]]) -> tuple[tuple[int, ...], tuple[int, ...]]:
    """The left image is the map canvas; the right image is the tileset palette."""
    images = sorted(
        (rect for n in nodes
         if n.get("class") == "android.widget.Image"
         and (rect := usable_bounds(n.get("bounds", ""))) is not None),
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
    toolbar_bounds = [
        rect for name in ("Pen", "L1", "L2", "L3", "Ev", "All")
        if (rect := usable_bounds(next(
            (node.get("bounds", "") for node in nodes
             if node.get("text", "").strip() == name),
            "",
        ))) is not None
    ]
    if not toolbar_bounds:
        raise AssertionError("No visible map toolbar controls have usable bounds")
    toolbar_bottom = max(rect[3] for rect in toolbar_bounds)
    x, y = canvas[0] + 110, canvas[1] + 40
    if not (canvas[0] < x < canvas[2] and max(toolbar_bottom, canvas[1]) < y
            < min(canvas[3], height - 80) and x < width):
        raise AssertionError(f"Paint point outside map canvas: {(x,y)}, {width}x{height}")
    return x, y


def event_point(nodes: list[dict[str, str]], width: int, height: int) -> tuple[int, int]:
    """Touch the synthetic event at map tile (1, 1) inside the visible canvas."""
    canvas, _ = editor_images(nodes)
    tile_size = tile_pixel_size()
    x, y = round(canvas[0] + tile_size * 1.5), round(canvas[1] + tile_size * 1.5)
    if not (canvas[0] < x < canvas[2] and canvas[1] < y < canvas[3]
            and x < width and y < height):
        raise AssertionError(f"Synthetic event target outside map canvas: {(x, y)}")
    return x, y


def tile_pixel_size() -> float:
    """Translate the 32-CSS-pixel XP tile to Android's physical screen coordinates."""
    output = run_adb("shell", "wm", "density").decode(errors="replace")
    densities = re.findall(r"(?:Physical|Override) density:\s*(\d+)", output)
    if not densities:
        raise AssertionError(f"Android did not report display density: {output.strip()!r}")
    return 32 * int(densities[-1]) / 160


def palette_point(nodes: list[dict[str, str]], width: int, height: int) -> tuple[int, int]:
    """Select the second synthetic palette tile (385) before painting."""
    _, palette = editor_images(nodes)
    x, y = palette[0] + 120, palette[1] + 40
    if not (palette[0] < x < min(palette[2], width)
            and palette[1] < y < min(palette[3], height)):
        raise AssertionError(f"Palette target outside image: {(x, y)}, {width}x{height}")
    return x, y


def wait_for_status(evidence: Path, name: str, status: str, seconds: int = 12):
    deadline = time.monotonic() + seconds
    last_nodes: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        last_nodes = helper.dump_ui(evidence, name)
        if status_visible(last_nodes, status):
            return last_nodes
        time.sleep(1)
    raise AssertionError(f"Map status {status!r} did not appear; visible text="
                         f"{[n.get('text', '') for n in last_nodes if n.get('text')]!r}")


def open_synthetic_event(evidence: Path, nodes: list[dict[str, str]],
                         width: int, height: int,
                         evidence_prefix: str = "map"):
    tap_named(nodes, "Ev")
    nodes = wait_for_status(evidence, "map-events-layer", "Events (1)")
    time.sleep(2)
    screenshot = run_adb("exec-out", "screencap", "-p")
    if not screenshot.startswith(b"\x89PNG\r\n\x1a\n"):
        raise AssertionError("Events-layer screenshot was not a PNG")
    (evidence / f"{evidence_prefix}-event-artwork.png").write_bytes(screenshot)
    helper.tap(event_point(nodes, width, height))
    ui_name = f"{evidence_prefix}-event-editor-open"
    helper.wait_for(evidence, ui_name, "Event [007] Synthetic Guide", 20)
    return helper.dump_ui(evidence, ui_name)


def command_text_is_visible(nodes: list[dict[str, str]], text: str) -> bool:
    return any(text in node.get("text", "") for node in nodes)


def dialogue_edit_committed(nodes: list[dict[str, str]], text: str) -> bool:
    return any(
        text in node.get("text", "")
        and "EditText" not in node.get("class", "")
        and usable_bounds(node.get("bounds", "")) is not None
        for node in nodes
    )


def is_gboard_audio_permission_prompt(nodes: list[dict[str, str]]) -> bool:
    return any(
        node.get("package") == "com.google.android.permissioncontroller"
        and node.get("text", "").strip() == "Allow Gboard to record audio?"
        for node in nodes
    )


def gboard_audio_permission_deny_button(nodes: list[dict[str, str]]) -> dict[str, str] | None:
    if not is_gboard_audio_permission_prompt(nodes):
        return None
    button = find_button(nodes, "Deny")
    if button is None:
        raise AssertionError("Gboard audio permission prompt has no visible Deny button")
    return button


def dialogue_ready_to_save(nodes: list[dict[str, str]], text: str) -> bool:
    return dialogue_edit_committed(nodes, text) and find_button(nodes, "Save & close") is not None


def wait_for_dialogue_input(evidence: Path, expected: str, previous: str,
                            timeout: int = 5) -> str:
    deadline = time.monotonic() + timeout
    observations: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "event-dialogue-input")
        field = focused_dialogue_field(nodes)
        if field:
            value = field.get("text", "")
            observations.append({
                "text": value,
                "bounds": field.get("bounds", ""),
                "class": field.get("class", ""),
            })
            if value == expected:
                return value
            if not previous.startswith(value) and not expected.startswith(value):
                raise AssertionError(
                    f"Dialogue input changed unexpectedly: {value!r}, "
                    f"expected {expected!r}"
                )
        time.sleep(0.25)
    (evidence / "dialogue-input-observations.json").write_text(
        json.dumps(observations, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    raise AssertionError(
        f"Dialogue input did not reach {expected!r} from {previous!r}; "
        f"focused field observations={observations!r}"
    )


def wait_for_focused_dialogue_field(evidence: Path, timeout: int = 8) -> dict[str, str]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "event-dialogue-focused-field")
        field = focused_dialogue_field(nodes)
        if field is not None:
            return field
        time.sleep(0.25)
    raise AssertionError("Focused dialogue field was not exposed after dismissing the keyboard")


def set_focused_dialogue_text(evidence: Path, updated: str) -> None:
    if updated != "Edited synthetic dialogue":
        raise AssertionError(f"Unsupported synthetic dialogue replacement: {updated!r}")
    jar_path = os.environ.get("ANDROID_DIALOGUE_INPUT_TEST_JAR", "")
    if not jar_path:
        raise AssertionError("Android accessibility dialogue input helper is unavailable")
    remote_jar = "/data/local/tmp/essentials-dialogue-input-test.jar"
    try:
        pushed = run_adb("push", jar_path, remote_jar)
        result = run_adb(
            "shell", "uiautomator", "runtest", remote_jar,
            "-c", "com.xbaconator.essentialsstudiomobile.smoketests.DialogueInputTest",
        )
    except RuntimeError as exc:
        (evidence / "dialogue-accessibility-input.txt").write_text(
            str(exc), encoding="utf-8"
        )
        raise
    (evidence / "dialogue-accessibility-input.txt").write_bytes(pushed + result)
    if not dialogue_input_test_succeeded(result):
        raise AssertionError(
            "Android accessibility dialogue input test did not complete successfully: "
            f"{result.decode(errors='replace')[-2000:]}"
        )


def dialogue_input_test_succeeded(output: bytes) -> bool:
    return (
        b"DIALOGUE_INPUT_TEST_PASS" in output
        and b"DIALOGUE_OK_ACTION_PASS" in output
        and b"OK (1 test)" in output
        and b"FAILURES!!!" not in output
        and b"Test run aborted" not in output
        and b"NoClassDefFoundError" not in output
    )


def edit_dialogue_in_editor(evidence: Path, original: str, updated: str) -> None:
    nodes = helper.dump_ui(evidence, "event-dialogue-before-edit")
    row = next((
        node for node in nodes
        if original in node.get("text", "")
        and usable_bounds(node.get("bounds", ""))
    ), None)
    if row is None:
        raise AssertionError(f"Visible dialogue command {original!r} was not found")
    helper.tap(helper.center(row["bounds"]))
    nodes = helper.dump_ui(evidence, "event-dialogue-selected")
    tap_named(nodes, "Edit dialogue")

    deadline = time.monotonic() + 10
    editor = None
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "event-dialogue-editing")
        editor = visible_dialogue_editor(nodes, original)
        if editor:
            break
        time.sleep(1)
    if editor is None:
        raise AssertionError("The explicit Edit dialogue action did not expose the visible text editor")

    field = wait_for_focused_dialogue_field(evidence)
    if not field.get("text"):
        raise AssertionError("Focused dialogue field has no accessible initial text")
    try:
        set_focused_dialogue_text(evidence, updated)
    except (AssertionError, RuntimeError):
        (evidence / "event-dialogue-input-failure.png").write_bytes(
            run_adb("exec-out", "screencap", "-p")
        )
        raise

    # Confirm with the single explicit action; blurring the field or hiding the
    # IME must not commit an unconfirmed draft.
    deadline = time.monotonic() + 12
    confirm_taps = 0
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "event-dialogue-finishing")
        permission_deny = gboard_audio_permission_deny_button(nodes)
        if permission_deny is not None:
            (evidence / "gboard-audio-permission.png").write_bytes(
                run_adb("exec-out", "screencap", "-p")
            )
            helper.tap(helper.center(permission_deny["bounds"]))
            confirm_taps = 0
            time.sleep(0.5)
            continue
        if dialogue_edit_committed(nodes, updated):
            break
        confirm_button = find_button(nodes, "OK")
        if confirm_button is not None and confirm_taps < 3:
            helper.tap(helper.center(confirm_button["bounds"]))
            confirm_taps += 1
        time.sleep(0.5)
    else:
        (evidence / "event-dialogue-input-failure.png").write_bytes(
            run_adb("exec-out", "screencap", "-p")
        )
        raise AssertionError(
            f"Dialogue edit did not leave its input field with committed text {updated!r}; "
            f"OK taps={confirm_taps}"
        )

    # Do not send Back here: once the IME is gone it closes the event editor.
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        nodes = helper.dump_ui(evidence, "event-dialogue-edited")
        if dialogue_ready_to_save(nodes, updated):
            (evidence / "event-dialogue-edited.png").write_bytes(
                run_adb("exec-out", "screencap", "-p")
            )
            tap_named(nodes, "Save & close")
            return
        time.sleep(1)
    raise AssertionError(
        f"Committed dialogue {updated!r} or visible OK action was lost after finishing the edit"
    )


def wait_for_map_after_event_save(evidence: Path):
    deadline = time.monotonic() + 30
    last_nodes: list[dict[str, str]] = []
    while time.monotonic() < deadline:
        last_nodes = helper.dump_ui(evidence, "map-after-event-save")
        if helper.editor_visible(last_nodes) and not any(
            "Event [007] Synthetic Guide" in node.get("text", "") for node in last_nodes
        ):
            return last_nodes
        errors = [
            node.get("text", "").strip() for node in last_nodes
            if "Save failed" in node.get("text", "")
            or "event edit" in node.get("text", "").lower()
        ]
        if errors:
            raise AssertionError(f"Native event dialogue save did not complete: {errors!r}")
        time.sleep(1)
    visible = [node.get("text", "").strip() for node in last_nodes if node.get("text")]
    raise AssertionError(
        f"Event editor did not close after saving dialogue; visible text={visible[-12:]!r}"
    )


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
        for button, expected in (("L2", "Layer 2/3"), ("L3", "Layer 3/3")):
            tap_named(nodes, button)
            nodes = wait_for_status(evidence, f"map-{expected.replace('/', '-')}",
                                    expected)
            (evidence / f"map-{expected.replace('/', '-')}.png").write_bytes(
                run_adb("exec-out", "screencap", "-p")
            )
        tap_named(nodes, "L1")
        nodes = wait_for_status(evidence, "map-layer-1-before-paint", "Layer 1/3")
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
        editor_nodes = open_synthetic_event(evidence, nodes, width, height)
        if not command_text_is_visible(editor_nodes, "Synthetic dialogue"):
            helper.wait_for(evidence, "event-dialogue-source", "Synthetic dialogue", 12)
        edit_dialogue_in_editor(evidence, "Synthetic dialogue", "Edited synthetic dialogue")
        nodes = wait_for_map_after_event_save(evidence)
        helper.tap(helper.wait_for(evidence, "map-save-control", "Save All", 12))
        deadline = time.monotonic() + 90
        log_output = ""
        while time.monotonic() < deadline:
            nodes = helper.dump_ui(evidence, "map-save-progress")
            log_output = run_adb("logcat", "-d", "-s", "Tauri/Console:I").decode(
                errors="replace"
            )
            if save_all_completed_in_log(log_output):
                break
            time.sleep(1)
        else:
            visible = [n.get("text", "") for n in nodes if n.get("text")]
            screenshot = run_adb("exec-out", "screencap", "-p")
            if not screenshot.startswith(b"\x89PNG\r\n\x1a\n"):
                raise AssertionError("Save All timeout screenshot was not a PNG")
            (evidence / "map-save-timeout.png").write_bytes(screenshot)
            save_events = [line for line in log_output.splitlines() if "[save-all]" in line]
            raise AssertionError(
                f"Save All did not finish; visible text={visible[-12:]!r}; "
                f"save events={save_events[-8:]!r}"
            )
        nodes = helper.dump_ui(evidence, "map-after-save")
        screenshot = run_adb("exec-out", "screencap", "-p")
        if not screenshot.startswith(b"\x89PNG\r\n\x1a\n"):
            raise AssertionError("Post-save screenshot was not a PNG")
        (evidence / "map-after-save.png").write_bytes(screenshot)
        if any("Save failed" in n.get("text", "") or "Error saving" in n.get("text", "")
               for n in nodes):
            raise AssertionError("Editor reported a Save All failure")
        if not save_all_success_visible(nodes):
            raise AssertionError("Save All did not show working-project success status")
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
        receipt["dialogue_before"] = "Synthetic dialogue"
        receipt["dialogue_after"] = "Edited synthetic dialogue"

        run_adb("shell", "am", "force-stop", package)
        time.sleep(2)
        run_adb(
            "shell", "monkey", "-p", package,
            "-c", "android.intent.category.LAUNCHER", "1",
        )
        helper.wait_for(evidence, "restart-welcome", "Reopen Last Project", 45)
        nodes = helper.dump_ui(evidence, "restart-welcome")
        if helper.editor_visible(nodes):
            raise AssertionError("Process restart unexpectedly skipped explicit project reopening")
        tap_named(nodes, "Reopen Last Project")
        deadline = time.monotonic() + 45
        while time.monotonic() < deadline:
            nodes = helper.dump_ui(evidence, "restart-project-open")
            helper.reject_editor_anr(nodes)
            if helper.editor_visible(nodes):
                break
            time.sleep(1)
        else:
            raise AssertionError("Reopen Last Project did not restore the Android editor")
        reopened_path = private_map_path(package)
        if reopened_path != path:
            raise AssertionError(
                f"Reopen Last Project changed working-copy identity: {reopened_path!r} != {path!r}"
            )
        reopened_map = read_private_map(package, reopened_path)
        reopened_sha = hashlib.sha256(reopened_map).hexdigest()
        if reopened_map != after:
            raise AssertionError(
                f"Save All working-copy bytes changed after process restart: "
                f"{reopened_sha} != {receipt['map_sha256_after']}"
            )
        nodes, width, height = wait_for_restarted_map(evidence)
        event_nodes = open_synthetic_event(
            evidence, nodes, width, height, "restart"
        )
        if not command_text_is_visible(event_nodes, "Edited synthetic dialogue"):
            raise AssertionError("Reopened working copy lost the saved event dialogue")
        (evidence / "restart-event-dialogue.png").write_bytes(
            run_adb("exec-out", "screencap", "-p")
        )
        source_hash = run_adb(
            "shell", "sha256sum", "/sdcard/Download/EssentialsSynthetic.zip"
        ).decode().split()[0]
        if source_hash != imported["fixture_sha256"]:
            raise AssertionError("Original imported ZIP changed during process restart")
        run_adb("shell", "input", "keyevent", "KEYCODE_BACK")
        nodes = wait_for_map_after_event_save(evidence)
        receipt["working_copy_sha256_after_restart"] = reopened_sha
        receipt["process_restart_pass"] = True
        receipt["reopened_dialogue"] = "Edited synthetic dialogue"
        receipt["result"] = "emulator_map_touch_save_pass"
    finally:
        try:
            (evidence / "map-save-logcat.txt").write_bytes(
                run_adb("logcat", "-d", "-v", "threadtime")
            )
        except (RuntimeError, subprocess.TimeoutExpired) as exc:
            (evidence / "map-save-logcat-error.txt").write_text(
                str(exc), encoding="utf-8"
            )
        (evidence / "map-edit-receipt.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )


def selftest() -> None:
    original_dump_ui = helper.dump_ui
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            helper.dump_ui = lambda *_args, **_kwargs: [{
                "text": "Edited synthetic dialogue",
                "class": "android.widget.EditText",
                "focused": "true",
                "bounds": "[100,200][700,300]",
            }]
            assert wait_for_dialogue_input(
                Path(temp_dir), "Edited synthetic dialogue", "Synthetic dialogue"
            ) == "Edited synthetic dialogue"
        finally:
            helper.dump_ui = original_dump_ui

    assert save_all_success_visible([{
        "text": "All registered editor changes were saved to the working project. "
                "The imported source ZIP is unchanged.",
        "bounds": "[20,100][600,180]",
    }])
    assert not save_all_success_visible([{"text": "Save all failed: storage unavailable"}])
    assert not save_all_success_visible([{
        "text": "All registered editor changes were saved to the working project.",
        "bounds": "[0,0][0,0]",
    }])
    assert not save_all_success_visible([])
    assert dialogue_edit_committed([
        {"text": "Edited synthetic dialogue", "class": "android.view.View",
         "bounds": "[735,378][1794,443]"},
    ], "Edited synthetic dialogue")
    assert not dialogue_edit_committed([
        {"text": "Edited synthetic dialogue", "class": "android.widget.EditText",
         "bounds": "[1015,385][1792,441]"},
    ], "Edited synthetic dialogue")
    assert is_gboard_audio_permission_prompt([
        {"text": "Allow Gboard to record audio?",
         "package": "com.google.android.permissioncontroller"},
    ])
    assert gboard_audio_permission_deny_button([
        {"text": "Allow Gboard to record audio?",
         "package": "com.google.android.permissioncontroller"},
        {"text": "Deny", "class": "android.widget.Button", "clickable": "true",
         "bounds": "[356,787][1437,934]"},
    ]) is not None
    try:
        gboard_audio_permission_deny_button([
            {"text": "Allow Gboard to record audio?",
             "package": "com.google.android.permissioncontroller"},
        ])
    except AssertionError as exc:
        assert "no visible Deny button" in str(exc)
    else:
        raise AssertionError("Gboard permission prompt without Deny action was accepted")
    unrelated_permission = [
        {"text": "Allow Gboard to record audio?",
         "package": "com.android.permissioncontroller"},
        {"text": "Deny", "class": "android.widget.Button", "clickable": "true",
         "bounds": "[356,787][1437,934]"},
    ]
    assert not is_gboard_audio_permission_prompt(unrelated_permission)
    assert gboard_audio_permission_deny_button(unrelated_permission) is None
    assert dialogue_ready_to_save([
        {"text": "Edited synthetic dialogue", "class": "android.view.View",
         "bounds": "[735,378][1794,443]"},
        {"text": "Save & close", "class": "android.widget.Button", "clickable": "true",
         "bounds": "[1464,863][1598,945]"},
    ], "Edited synthetic dialogue")
    assert not dialogue_ready_to_save([
        {"text": "Edited synthetic dialogue", "class": "android.view.View",
         "bounds": "[735,378][1794,443]"},
    ], "Edited synthetic dialogue")
    assert find_button([
        {"text": "OK", "class": "android.widget.Button",
         "clickable": "true", "bounds": "[1464,863][1598,945]"},
    ], "OK") is not None
    assert find_button([
        {"text": "OK", "class": "android.widget.Button",
         "clickable": "false", "bounds": "[1464,863][1598,945]"},
    ], "OK") is None
    assert find_button([
        {"text": "Done editing", "class": "android.widget.Button",
         "clickable": "true", "bounds": "[1464,863][1598,945]"},
    ], "OK") is None
    original_run_adb = globals()["run_adb"]
    original_jar = os.environ.get("ANDROID_DIALOGUE_INPUT_TEST_JAR")
    observed_commands: list[tuple[str, ...]] = []
    with tempfile.TemporaryDirectory() as temp_dir:
        try:
            os.environ["ANDROID_DIALOGUE_INPUT_TEST_JAR"] = "/tmp/dialogue-test.jar"
            globals()["run_adb"] = lambda *args, timeout=45: (
                observed_commands.append(args)
                or (
                    b"DIALOGUE_OK_ACTION_PASS\nDIALOGUE_INPUT_TEST_PASS\nOK (1 test)"
                    if "runtest" in args else b"1 file pushed"
                )
            )
            set_focused_dialogue_text(Path(temp_dir), "Edited synthetic dialogue")
            assert (Path(temp_dir) / "dialogue-accessibility-input.txt").read_bytes() == (
                b"1 file pushedDIALOGUE_OK_ACTION_PASS\nDIALOGUE_INPUT_TEST_PASS\nOK (1 test)"
            )
        finally:
            globals()["run_adb"] = original_run_adb
            if original_jar is None:
                os.environ.pop("ANDROID_DIALOGUE_INPUT_TEST_JAR", None)
            else:
                os.environ["ANDROID_DIALOGUE_INPUT_TEST_JAR"] = original_jar
    assert observed_commands == [
        ("push", "/tmp/dialogue-test.jar", "/data/local/tmp/essentials-dialogue-input-test.jar"),
        ("shell", "uiautomator", "runtest", "/data/local/tmp/essentials-dialogue-input-test.jar",
         "-c", "com.xbaconator.essentialsstudiomobile.smoketests.DialogueInputTest"),
    ]
    assert dialogue_input_test_succeeded(
        b"DIALOGUE_OK_ACTION_PASS\nDIALOGUE_INPUT_TEST_PASS\nOK (1 test)\n"
        b"INSTRUMENTATION_STATUS_CODE: -1"
    )
    assert not dialogue_input_test_succeeded(
        b"DIALOGUE_OK_ACTION_PASS\nDIALOGUE_INPUT_TEST_PASS\nINSTRUMENTATION_STATUS_CODE: -1"
    )
    assert not dialogue_input_test_succeeded(
        b"DIALOGUE_INPUT_TEST_PASS\nOK (1 test)\nINSTRUMENTATION_STATUS_CODE: -1"
    )
    assert not dialogue_input_test_succeeded(b"OK (1 test)")
    assert not dialogue_input_test_succeeded(
        b"DIALOGUE_INPUT_TEST_PASS\nFAILURES!!!\nTests run: 1, Failures: 1\n"
        b"INSTRUMENTATION_STATUS_CODE: -1"
    )
    assert not dialogue_input_test_succeeded(
        b"Test run aborted: NoClassDefFoundError\nOK (1 test)\n"
        b"INSTRUMENTATION_STATUS_CODE: -1"
    )

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
    assert status_visible(nodes, "Layer 1/3")
    assert not save_all_completed_in_log(
        "[save-all] operation lock acquired\n"
        "[save-all] native map save completed\n"
        "[save-all] operation completed"
    )
    assert save_all_completed_in_log(
        "[save-all] operation lock acquired\n"
        "[save-all] native map save completed\n"
        "[save-all] operation completed\n"
        "[save-all] toolbar state saving=false"
    )
    assert not save_all_completed_in_log(
        "[save-all] operation lock acquired\n"
        "[save-all] toolbar state saving=false\n"
        "[save-all] native map save completed\n"
        "[save-all] operation completed"
    )
    assert paint_point(nodes, 1794, 1080) == (789, 355)
    assert palette_point(nodes, 1794, 1080) == (1361, 394)
    original_run_adb = globals()["run_adb"]
    try:
        globals()["run_adb"] = lambda *args, **kwargs: b"Physical density: 420\n"
        assert tile_pixel_size() == 84
        assert event_point(nodes, 1794, 1080) == (805, 441)
    finally:
        globals()["run_adb"] = original_run_adb
    assert usable_bounds("[0,0][0,0]") is None
    overview = [
        {"text": "Maps", "class": "android.widget.TextView",
         "clickable": "false", "bounds": "[28,693][118,737]"},
        {"text": "Maps", "class": "android.widget.Button",
         "clickable": "true", "bounds": "[280,1774][543,1794]"},
    ]
    assert find_button(overview, "Maps") is overview[1]
    assert not map_editor_visible(overview)
    dialogue_edit_action = {
        "text": "Edit dialogue",
        "content-desc": "Edit dialogue",
        "bounds": "[100,200][160,250]",
    }
    assert find_named([dialogue_edit_action], "Edit dialogue") is dialogue_edit_action
    accessible_dialogue_editor = {
        "text": "",
        "content-desc": "Show Text dialogue lines",
        "focused": "true",
        "bounds": "[100,200][400,320]",
    }
    assert visible_dialogue_editor(
        [accessible_dialogue_editor], "Original synthetic dialogue"
    ) is accessible_dialogue_editor
    assert focused_dialogue_field(
        [accessible_dialogue_editor]
    ) is accessible_dialogue_editor
    native_dialogue_editor = {
        "text": "Original synthetic dialogue",
        "class": "android.widget.EditText",
        "focused": "false",
        "bounds": "[100,200][400,320]",
    }
    assert visible_dialogue_editor(
        [native_dialogue_editor], "Original synthetic dialogue"
    ) is native_dialogue_editor
    assert focused_dialogue_field([native_dialogue_editor]) is None
    map_editor = [
        {"text": "Ev", "class": "android.widget.Button", "clickable": "true",
         "bounds": "[1057,462][1147,527]"},
        *[
            {"text": layer, "class": "android.widget.Button", "clickable": "true",
             "bounds": f"[{left},462][{left + 90},527]"}
            for layer, left in (("L1", 805), ("L2", 889), ("L3", 973))
        ],
        {"text": "", "class": "android.widget.Image", "bounds": "[679,315][1241,1018]"},
        {"text": "", "class": "android.widget.Image", "bounds": "[1241,354][1794,1039]"},
    ]
    assert map_editor_visible(map_editor)
    assert not map_editor_visible([
        {"text": "Ev", "class": "android.widget.Button", "clickable": "true",
         "bounds": "[0,0][100,50]"},
    ])
    nodes[5]["bounds"] = "[0,0][0,0]"
    assert find_named(nodes, "L1")["bounds"] == "[1399,217][1488,283]"
    try:
        find_named(nodes, "L2")
    except AssertionError:
        pass
    else:
        raise AssertionError("A zero-bounds toolbar node was treated as visible")
    assert paint_point(nodes, 1794, 1080) == (789, 355)
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
