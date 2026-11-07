#!/usr/bin/env python3
"""Fail-closed real Android DocumentsUI SAF export and ZIP preservation gate.

Runs after synthetic ZIP import and map touch/save on an Android emulator.
This is NOT physical ARM64 provider, desktop RPG Maker XP, or gameplay evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import subprocess
import time
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "android_import_helper", Path(__file__).with_name("android-emulator-import-smoke.py")
)
assert spec and spec.loader
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

MAX_SYNTHETIC_ZIP_BYTES = 16 * 1024 * 1024
EXPORT_FILENAME = "Synthetic_RMXP.zip"
ORIGINAL_REMOTE = "/sdcard/Download/EssentialsSynthetic.zip"
EXPORTED_REMOTE = "/sdcard/Download/" + EXPORT_FILENAME


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def adb_bytes(*args: str, timeout: int = 45) -> bytes:
    completed = subprocess.run(["adb", *args], capture_output=True, timeout=timeout)
    if completed.returncode:
        raise RuntimeError(
            f"adb {args[:3]!r} failed: {completed.stderr.decode(errors='replace')[-500:]}"
        )
    return completed.stdout


def read_remote(path: str) -> bytes:
    size_text = adb_bytes("shell", "stat", "-c", "%s", path).decode().strip()
    size = int(size_text)
    if not 100 <= size <= MAX_SYNTHETIC_ZIP_BYTES:
        raise AssertionError(f"Unexpected synthetic ZIP size: {size}")
    payload = adb_bytes("exec-out", "cat", path, timeout=60)
    if len(payload) != size:
        raise AssertionError(f"Short Android document read: {len(payload)} != {size}")
    return payload


def archive_files(data: bytes) -> dict[str, bytes]:
    """Normalize a single optional wrapper folder, preserving every file."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        files = [info for info in archive.infolist() if not info.is_dir()]
        project_roots = [
            info.filename[:-len("Game.rxproj")]
            for info in files if info.filename.endswith("Game.rxproj")
        ]
        if len(project_roots) != 1:
            raise AssertionError(f"Expected one RMXP project root, got {project_roots!r}")
        prefix = project_roots[0]
        result: dict[str, bytes] = {}
        for info in files:
            if not info.filename.startswith(prefix):
                raise AssertionError(f"ZIP member outside project root: {info.filename!r}")
            name = info.filename[len(prefix):]
            if not name or name in result or name.startswith("/") or ".." in name.split("/"):
                raise AssertionError(f"Unsafe/duplicate ZIP member: {name!r}")
            result[name] = archive.read(info)
        return result


def assert_preserved(
    original: bytes,
    exported: bytes,
    edited_map_sha: str,
    expected_new_files: dict[str, str] | None = None,
) -> int:
    old = archive_files(original)
    new = archive_files(exported)
    expected_new_files = expected_new_files or {}
    if old.keys() & expected_new_files.keys():
        raise AssertionError("Expected new ZIP member already exists in the source archive")
    expected_members = old.keys() | expected_new_files.keys()
    if new.keys() != expected_members:
        raise AssertionError(
            f"ZIP member loss/addition: removed={sorted(old.keys()-new.keys())}, "
            f"unexpected={sorted(new.keys()-expected_members)}, "
            f"missing_expected={sorted(expected_new_files.keys()-new.keys())}"
        )
    map_name = "Data/Map001.rxdata"
    if map_name not in old or map_name not in new:
        raise AssertionError("Map001.rxdata missing from project ZIP")
    if old[map_name] == new[map_name] or sha(new[map_name]) != edited_map_sha:
        raise AssertionError("Export does not contain the actual saved map bytes")
    if not new[map_name].startswith(b"\x04\x08"):
        raise AssertionError("Exported map lost Ruby Marshal signature")
    for name, contents in old.items():
        if name != map_name and new[name] != contents:
            raise AssertionError(f"Untouched project member changed: {name}")
    for name, expected_sha in expected_new_files.items():
        if sha(new[name]) != expected_sha:
            raise AssertionError(f"New project member differs from its saved editor bytes: {name}")
    return len(new)


def picker_snapshot(evidence: Path, name: str) -> tuple[list[dict[str, str]], str]:
    nodes = helper.dump_ui(evidence, name)
    xml = (evidence / f"{name}.xml").read_text(encoding="utf-8")
    return nodes, xml


def select_download_destination(evidence: Path) -> None:
    nodes, xml = picker_snapshot(evidence, "export-picker-initial")
    if not helper.documents_ui_visible(nodes):
        raise AssertionError("Export did not open native Android DocumentsUI")
    if helper.picker_breadcrumb(xml).casefold() in {"download", "downloads"}:
        return
    roots = helper.locate(nodes, "Show roots")
    if roots:
        helper.tap(roots)
        time.sleep(2)
        nodes, xml = picker_snapshot(evidence, "export-roots")
    storage = helper.external_storage_root(nodes)
    if storage is None:
        raise AssertionError("No external storage root available for SAF export")
    helper.tap(storage)
    time.sleep(2)
    for attempt, target in enumerate(("title", "icon", "row")):
        nodes, xml = picker_snapshot(evidence, f"export-storage-{attempt}")
        if helper.picker_breadcrumb(xml).casefold() in {"download", "downloads"}:
            return
        point = (helper.picker_folder_row(xml, "Download", target)
                 or helper.picker_folder_row(xml, "Downloads", target))
        if point:
            helper.tap(point)
            time.sleep(3)
    nodes, xml = picker_snapshot(evidence, "export-storage-final")
    if helper.picker_breadcrumb(xml).casefold() not in {"download", "downloads"}:
        if helper.activate_picker_item_keyboard(evidence, "Download", "export-download"):
            time.sleep(3)
            nodes, xml = picker_snapshot(evidence, "export-storage-keyboard")
    if helper.picker_breadcrumb(xml).casefold() not in {"download", "downloads"}:
        raise AssertionError("Native SAF picker did not enter Download destination")


def save_button(nodes: list[dict[str, str]]) -> tuple[int, int]:
    if not helper.documents_ui_visible(nodes):
        raise AssertionError("Cannot save without native DocumentsUI")
    buttons = [
        n for n in nodes
        if n.get("text", "").strip().casefold() in {"save", "create"}
        and n.get("bounds")
        and n.get("package", "").startswith(
            ("com.android.documentsui", "com.google.android.documentsui")
        )
    ]
    if len(buttons) != 1:
        raise AssertionError(f"Expected one native Save/Create action, got {len(buttons)}")
    return helper.center(buttons[0]["bounds"])


def run(evidence: Path) -> None:
    imported = json.loads((evidence / "import-receipt.json").read_text())
    painted = json.loads((evidence / "map-edit-receipt.json").read_text())
    sprite = json.loads((evidence / "sprite-edit-receipt.json").read_text())
    if imported.get("result") != "emulator_zip_import_open_pass":
        raise AssertionError("Android ZIP import must pass before export")
    if painted.get("result") != "emulator_map_touch_save_pass":
        raise AssertionError("Android touch and Save All must pass before export")
    sprite_path = Path(str(sprite.get("saved_copy", "")))
    if (
        sprite.get("result") != "android_sprite_edit_copy_pass"
        or sprite.get("save_mode") != "copy"
        or sprite.get("original_sha256_unchanged") is not True
        or sprite_path.parts[-3:-1] != ("Graphics", "Characters")
        or sprite_path.name != "SyntheticGuide_copy.png"
        or not isinstance(sprite.get("saved_copy_sha256"), str)
    ):
        raise AssertionError("Expected a verified safe-copy sprite edit before export")
    expected_new_files = {
        "Graphics/Characters/SyntheticGuide_copy.png": sprite["saved_copy_sha256"]
    }
    receipt = {"result": "failed", "source_sha": imported["source_sha"]}
    try:
        original = read_remote(ORIGINAL_REMOTE)
        if sha(original) != imported["fixture_sha256"]:
            raise AssertionError("Original ZIP changed before export")
        helper.tap(helper.wait_for(evidence, "export-editor-before", "Export ZIP...", 15))
        deadline = time.monotonic() + 45
        nodes = []
        while time.monotonic() < deadline:
            nodes, _ = picker_snapshot(evidence, "export-after-tap")
            helper.reject_editor_anr(nodes)
            if helper.documents_ui_visible(nodes):
                break
            time.sleep(3)
        if not helper.documents_ui_visible(nodes):
            raise AssertionError("Export ZIP did not open a native SAF destination picker")
        select_download_destination(evidence)
        nodes, _ = picker_snapshot(evidence, "export-before-save")
        helper.tap(save_button(nodes))
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            nodes, _ = picker_snapshot(evidence, "export-after-save")
            helper.reject_editor_anr(nodes)
            if (not helper.documents_ui_visible(nodes)
                    and helper.locate(nodes, "byte-verified") is not None):
                break
            if any("Project ZIP export failed" in n.get("text", "") for n in nodes):
                raise AssertionError("Editor reported native SAF export failure")
            time.sleep(3)
        else:
            raise AssertionError("No byte-verified SAF export confirmation")
        # This test intentionally uses the emulator's external-storage provider.
        # A physical Android phone's SAF provider remains a separate gate.
        exported = read_remote(EXPORTED_REMOTE)
        receipt["exported_sha256"] = sha(exported)
        receipt["members_preserved"] = assert_preserved(
            original, exported, painted["map_sha256_after"], expected_new_files
        )
        if sha(read_remote(ORIGINAL_REMOTE)) != imported["fixture_sha256"]:
            raise AssertionError("Original ZIP changed during SAF export")
        receipt["original_zip_unchanged"] = True
        receipt["result"] = "emulator_saf_export_roundtrip_pass"
    finally:
        (evidence / "saf-export-receipt.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )
        # The native save picker can disappear without resolving the WebView
        # callback. Capture actual Android diagnostics on BOTH pass and fail
        # so we can distinguish a missing picker callback, provider write,
        # and readback failure rather than blindly retrying an emulator.
        for name, command in (
            ("saf-export-logcat.txt", ("logcat", "-d", "-v", "time")),
            ("saf-export-provider-files.txt", ("shell", "ls", "-la", "/sdcard/Download")),
            ("saf-export-activity.txt", ("shell", "dumpsys", "activity", "activities")),
        ):
            try:
                (evidence / name).write_bytes(adb_bytes(*command, timeout=25)[-2_000_000:])
            except (OSError, RuntimeError, subprocess.TimeoutExpired) as exc:
                (evidence / name).write_text(f"Diagnostic unavailable: {exc}\\n")
        try:
            (evidence / "saf-export-screen.png").write_bytes(
                adb_bytes("exec-out", "screencap", "-p")
            )
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            pass


def selftest() -> None:
    def zip_of(entries: dict[str, bytes]) -> bytes:
        output = io.BytesIO()
        with zipfile.ZipFile(output, "w") as z:
            for name, contents in entries.items():
                z.writestr(name, contents)
        return output.getvalue()

    old = zip_of({
        "Wrapper/Game.rxproj": b"synthetic",
        "Wrapper/Data/Map001.rxdata": b"\x04\x08" + b"a" * 100,
        "Wrapper/PBS/pokemon.txt": b"synthetic PBS\n",
        "Wrapper/Graphics/Empty": b"",
    })
    new = zip_of({
        "Game.rxproj": b"synthetic",
        "Data/Map001.rxdata": b"\x04\x08" + b"b" * 100,
        "PBS/pokemon.txt": b"synthetic PBS\n",
        "Graphics/Empty": b"",
    })
    assert assert_preserved(old, new, sha(b"\x04\x08" + b"b" * 100)) == 4
    sprite = b"edited synthetic sprite"
    with_sprite = zip_of({
        "Game.rxproj": b"synthetic",
        "Data/Map001.rxdata": b"\x04\x08" + b"b" * 100,
        "PBS/pokemon.txt": b"synthetic PBS\n",
        "Graphics/Empty": b"",
        "Graphics/Characters/SyntheticGuide_copy.png": sprite,
    })
    expected_sprite = {"Graphics/Characters/SyntheticGuide_copy.png": sha(sprite)}
    assert assert_preserved(
        old, with_sprite, sha(b"\x04\x08" + b"b" * 100), expected_sprite
    ) == 5
    extra_file = zip_of({
        "Game.rxproj": b"synthetic",
        "Data/Map001.rxdata": b"\x04\x08" + b"b" * 100,
        "PBS/pokemon.txt": b"synthetic PBS\n",
        "Graphics/Empty": b"",
        "Graphics/Characters/SyntheticGuide_copy.png": sprite,
        "Scripts/Unexpected.rxdata": b"not expected",
    })
    try:
        assert_preserved(
            old, extra_file, sha(b"\x04\x08" + b"b" * 100), expected_sprite
        )
    except AssertionError:
        pass
    else:
        raise AssertionError("Unexpected ZIP member addition was accepted")
    wrong_sprite = {"Graphics/Characters/SyntheticGuide_copy.png": sha(b"wrong sprite")}
    try:
        assert_preserved(
            old, with_sprite, sha(b"\x04\x08" + b"b" * 100), wrong_sprite
        )
    except AssertionError:
        pass
    else:
        raise AssertionError("Changed saved sprite bytes were accepted")
    try:
        assert_preserved(old, new, sha(b"wrong"))
    except AssertionError:
        pass
    else:
        raise AssertionError("Incorrect map hash was accepted")
    damaged = zip_of({
        "Game.rxproj": b"synthetic",
        "Data/Map001.rxdata": b"\x04\x08" + b"b" * 100,
        "PBS/pokemon.txt": b"damaged",
        "Graphics/Empty": b"",
    })
    try:
        assert_preserved(old, damaged, sha(b"\x04\x08" + b"b" * 100))
    except AssertionError:
        pass
    else:
        raise AssertionError("Unrelated PBS corruption was accepted")
    try:
        save_button([{"package": "com.example.fake", "text": "Save",
                      "bounds": "[1,1][10,10]"}])
    except AssertionError:
        pass
    else:
        raise AssertionError("Non-native save button was accepted")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--evidence", type=Path, default=Path("android-runtime-evidence"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        selftest()
        print("Android SAF export and ZIP preservation self-tests passed")
        return 0
    try:
        run(args.evidence)
    except Exception as exc:
        print(f"Android native SAF export NOT verified: {exc}")
        return 1
    print("Android emulator SAF export verified with saved sprite and original-member byte preservation")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
