#!/usr/bin/env python3
"""Re-import a real Android SAF-exported synthetic ZIP through DocumentsUI.

This is an emulator persistence gate, NOT desktop RMXP or physical phone proof.
Requires successful import, touch/save and SAF export receipts from this run.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path


def load_helper(filename: str, name: str):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


picker = load_helper("android-emulator-import-smoke.py", "android_import_helper")
map_helper = load_helper("android-emulator-map-save-smoke.py", "android_map_helper")
export_helper = load_helper("android-emulator-saf-export-smoke.py", "android_export_helper")


def private_map_paths(package: str) -> set[str]:
    """Find exact files in the app sandbox without a shell -c quoting ambiguity."""
    output = map_helper.run_adb(
        "shell", "run-as", package, "find", ".", "-type", "f",
        "-name", "Map001.rxdata", "-print"
    ).decode(errors="replace")
    paths = {line.strip() for line in output.splitlines() if line.strip()}
    if not paths or any(
        not path.startswith("./projects/") or not path.endswith("/Data/Map001.rxdata")
        or ".." in path.split("/")
        for path in paths
    ):
        raise AssertionError(f"Unexpected private map paths: {sorted(paths)!r}")
    return paths


def expected_member_paths(root: str, members: dict[str, bytes]) -> set[str]:
    """Require a safe, exact file manifest before comparing private import bytes."""
    if not root.startswith("./projects/import-") or "/" in root[len("./projects/"):]:
        raise AssertionError(f"Invalid imported project root: {root!r}")
    paths = set()
    for name in members:
        if (not name or name.startswith("/") or "\\" in name
                or any(part in ("", ".", "..") for part in name.split("/"))):
            raise AssertionError(f"Unsafe exported member name: {name!r}")
        paths.add(f"{root}/{name}")
    return paths


def verify_reimported_members(package: str, map_path: str, exported_zip: bytes) -> int:
    """Compare every extracted file, not only Map001, against the SAF ZIP."""
    suffix = "/Data/Map001.rxdata"
    if not map_path.endswith(suffix):
        raise AssertionError(f"Invalid re-imported map path: {map_path!r}")
    root = map_path[:-len(suffix)]
    members = export_helper.archive_files(exported_zip)
    expected = expected_member_paths(root, members)
    output = map_helper.run_adb(
        "shell", "run-as", package, "find", root, "-type", "f", "-print"
    ).decode(errors="replace")
    actual_paths = {line.strip() for line in output.splitlines() if line.strip()}
    if actual_paths != expected:
        raise AssertionError(
            f"Re-import member mismatch: missing={sorted(expected-actual_paths)!r}, "
            f"extra={sorted(actual_paths-expected)!r}"
        )
    for name, original in members.items():
        imported = map_helper.run_adb(
            "exec-out", "run-as", package, "cat", f"{root}/{name}", timeout=60
        )
        if imported != original:
            raise AssertionError(f"Re-import altered member {name!r}: "
                                 f"expected_sha={hashlib.sha256(original).hexdigest()}, "
                                 f"actual_sha={hashlib.sha256(imported).hexdigest()}")
    return len(members)


def one_new_path(before: set[str], after: set[str]) -> str:
    if not before.issubset(after):
        raise AssertionError(f"An existing imported project disappeared: {sorted(before-after)}")
    new = after - before
    if len(new) != 1:
        raise AssertionError(f"Expected exactly one newly imported map, got {sorted(new)!r}")
    return next(iter(new))


def wait_for_reimported_map(
    package: str, evidence: Path, before: set[str], expected_sha: str, seconds: int
) -> tuple[str, str]:
    """Require a distinct completed import, not the still-visible previous editor."""
    deadline = time.monotonic() + seconds
    last = "No newly imported map observed"
    attempt = 0
    while time.monotonic() < deadline:
        attempt += 1
        nodes = picker.dump_ui(evidence, f"reimport-wait-{attempt}")
        picker.reject_editor_anr(nodes)
        if any("Project ZIP import failed" in n.get("text", "") for n in nodes):
            raise AssertionError("Editor reported exported ZIP re-import failure")
        paths = private_map_paths(package)
        if not before.issubset(paths):
            raise AssertionError("Previously imported project disappeared during re-import")
        new = paths - before
        if len(new) > 1:
            raise AssertionError(f"Re-import created multiple project maps: {sorted(new)!r}")
        if len(new) == 1:
            path = one_new_path(before, paths)
            try:
                map_bytes = map_helper.read_private_map(package, path)
            except AssertionError as exc:
                last = f"New map not yet readable: {exc}"
            else:
                actual_sha = hashlib.sha256(map_bytes).hexdigest()
                if actual_sha == expected_sha and picker.editor_visible(nodes):
                    return path, actual_sha
                last = (
                    f"New map {path} sha={actual_sha}, expected={expected_sha}, "
                    f"editor_visible={picker.editor_visible(nodes)}"
                )
        time.sleep(3)
    raise AssertionError(f"Re-import did not complete within {seconds}s: {last}")



def current_picker_location(xml: str) -> str:
    """Return the LAST breadcrumb: ExternalStorageProvider has nested crumbs."""
    start = xml.find("<?xml")
    root = ET.fromstring(xml[start:] if start >= 0 else xml)
    names = [
        node.get("text", "").strip()
        for node in root.iter("node")
        if picker.documents_ui_id(node.get("resource-id", ""), "breadcrumb_text")
    ]
    return names[-1] if names else ""


def reimport_picker_snapshot(evidence: Path, label: str):
    nodes = picker.dump_ui(evidence, label)
    if not picker.documents_ui_visible(nodes):
        raise AssertionError("Native DocumentsUI disappeared before ZIP selection")
    xml = (evidence / f"{label}.xml").read_text(encoding="utf-8")
    return nodes, xml


def select_exported_zip(evidence: Path, filename: str) -> bool:
    """Select the exact SAF export through the external-storage document provider.

    The Android 11 landscape picker displays ZIP thumbnails while their file
    titles are BELOW the visible viewport. In run 41254689133, this made the
    generic grid selector fail even though Download had actually opened.
    Switch to native list view and require the exact filename, never select a
    neighbouring ZIP or infer success from the previously open editor.
    """
    nodes, xml = reimport_picker_snapshot(evidence, "reimport-picker-initial")
    # GET_CONTENT often starts in the Downloads virtual root, already showing
    # the exact SAF export. Never leave that valid location just to navigate
    # back via the physical storage root: landscape grid folder taps can fail.
    if current_picker_location(xml).casefold() not in {"download", "downloads"}:
        storage = picker.external_storage_root(nodes)
        if storage is None:
            roots = picker.locate(nodes, "Show roots")
            if roots is None:
                raise AssertionError("Native picker has no Show roots action")
            picker.tap(roots)
            time.sleep(2)
            nodes, xml = reimport_picker_snapshot(evidence, "reimport-picker-roots")
            storage = picker.external_storage_root(nodes)
        if storage is None:
            raise AssertionError("ExternalStorageProvider root unavailable")
        picker.tap(storage)
        time.sleep(2)

        for attempt, target in enumerate(("title", "icon", "row", "title")):
            nodes, xml = reimport_picker_snapshot(evidence, f"reimport-root-{attempt}")
            if current_picker_location(xml).casefold() in {"download", "downloads"}:
                break
            folder = (picker.picker_folder_row(xml, "Download", target)
                      or picker.picker_folder_row(xml, "Downloads", target))
            if folder is None:
                raise AssertionError("External storage root has no Download folder")
            picker.tap(folder)
            time.sleep(3)
        nodes, xml = reimport_picker_snapshot(evidence, "reimport-download")
        if current_picker_location(xml).casefold() not in {"download", "downloads"}:
            raise AssertionError(
                "DocumentsUI did not enter external storage Download: "
                + repr(current_picker_location(xml))
            )

    # AOSP API30 grid in landscape clips filenames below the screen edge.
    # Native list mode exposes full rows and exact text in accessibility XML.
    list_action = picker.picker_list_view_control(nodes)
    if list_action is not None:
        picker.tap(list_action)
        for switch_attempt in range(5):
            time.sleep(1)
            nodes, xml = reimport_picker_snapshot(
                evidence, f"reimport-list-switch-{switch_attempt}"
            )
            if picker.picker_list_view_control(nodes) is None:
                break
        else:
            raise AssertionError("DocumentsUI did not switch to list view")
    for attempt in range(5):
        nodes, xml = reimport_picker_snapshot(evidence, f"reimport-file-{attempt}")
        if current_picker_location(xml).casefold() not in {"download", "downloads"}:
            raise AssertionError("Picker left Download before exact file selection")
        card = picker.picker_file_card(xml, filename)
        if card is not None:
            picker.tap(card)
            time.sleep(3)
            nodes = picker.dump_ui(evidence, "reimport-after-exact-file-tap")
            if not picker.documents_ui_visible(nodes):
                return True
            # Keyboard fallback is safe ONLY when focus identifies this exact ZIP.
            if picker.activate_picker_item_keyboard(
                evidence, filename, "reimport-exact-file", steps=18
            ):
                time.sleep(3)
                nodes = picker.dump_ui(evidence, "reimport-after-exact-keyboard")
                if not picker.documents_ui_visible(nodes):
                    return True
            raise AssertionError(
                f"DocumentsUI did not return after selecting exact ZIP {filename!r}"
            )
        time.sleep(2)
    raise AssertionError(
        f"Exported ZIP {filename!r} absent from external storage Download list"
    )


def run(package: str, evidence: Path) -> None:
    imported = json.loads((evidence / "import-receipt.json").read_text())
    painted = json.loads((evidence / "map-edit-receipt.json").read_text())
    exported = json.loads((evidence / "saf-export-receipt.json").read_text())
    required = (
        (imported, "emulator_zip_import_open_pass"),
        (painted, "emulator_map_touch_save_pass"),
        (exported, "emulator_saf_export_roundtrip_pass"),
    )
    if any(receipt.get("result") != expected for receipt, expected in required):
        raise AssertionError("Import, map save and SAF export must pass before re-import")
    receipt = {"source_sha": imported["source_sha"], "result": "failed"}
    try:
        zip_before = export_helper.read_remote(export_helper.EXPORTED_REMOTE)
        zip_sha = hashlib.sha256(zip_before).hexdigest()
        if zip_sha != exported["exported_sha256"]:
            raise AssertionError("SAF export bytes differ from verified export receipt")
        before = private_map_paths(package)
        receipt["existing_map_count"] = len(before)

        nodes = picker.dump_ui(evidence, "reimport-editor-before")
        if not picker.editor_visible(nodes):
            raise AssertionError("Editor not open before re-import")
        target = (picker.locate(nodes, "Import ZIP...")
                  or picker.locate(nodes, "Choose Essentials Project ZIP"))
        if target is None:
            raise AssertionError("Loaded editor has no Android ZIP import control")
        picker.tap(target)
        picker.wait_for_document_picker(evidence, 20)
        if not select_exported_zip(evidence, export_helper.EXPORT_FILENAME):
            raise AssertionError("Native DocumentsUI did not select exported ZIP")
        # The old project remains visible while the new ZIP is importing.
        # A generic "editor visible" check can therefore pass too early.
        # Wait for a *new* app-private map with the expected saved bytes.
        path, map_sha = wait_for_reimported_map(
            package, evidence, before, painted["map_sha256_after"], 75
        )
        receipt["reimported_member_count"] = verify_reimported_members(
            package, path, zip_before
        )
        if hashlib.sha256(export_helper.read_remote(export_helper.EXPORTED_REMOTE)).hexdigest() != zip_sha:
            raise AssertionError("SAF-exported ZIP was mutated during reimport")
        if hashlib.sha256(export_helper.read_remote(export_helper.ORIGINAL_REMOTE)).hexdigest() != imported["fixture_sha256"]:
            raise AssertionError("Original source ZIP was mutated during reimport")
        receipt.update({
            "result": "emulator_export_reimport_pass",
            "exported_zip_sha256": zip_sha,
            "reimported_map_sha256": map_sha,
            "new_project_map_path": path,
            "source_and_export_zips_unchanged": True,
        })
    finally:
        (evidence / "export-reimport-receipt.json").write_text(
            json.dumps(receipt, indent=2) + "\n", encoding="utf-8"
        )
        try:
            (evidence / "export-reimport-screen.png").write_bytes(
                export_helper.adb_bytes("exec-out", "screencap", "-p")
            )
        except (OSError, RuntimeError, subprocess.TimeoutExpired):
            pass


def selftest() -> None:
    xml = ('<?xml version="1.0"?><hierarchy>'
           '<node resource-id="com.google.android.documentsui:id/breadcrumb_text" '
           'text="sdk_gphone_x86_64" />'
           '<node resource-id="com.google.android.documentsui:id/breadcrumb_text" '
           'text="Download" /></hierarchy>')
    assert current_picker_location(xml) == "Download"
    # Captured Android 11 DocumentsUI starts in virtual Downloads with the
    # exported ZIP already listed. It must not be navigated away from.
    downloads_xml = ('<?xml version="1.0"?><hierarchy>'
                     '<node resource-id="com.google.android.documentsui:id/breadcrumb_text" '
                     'text="Downloads" />'
                     '<node resource-id="com.google.android.documentsui:id/item_root" '
                     'class="android.widget.LinearLayout" bounds="[0,641][1794,830]">'
                     '<node resource-id="android:id/title" text="Synthetic_RMXP.zip" '
                     'bounds="[189,685][557,742]" /></node></hierarchy>')
    assert current_picker_location(downloads_xml).casefold() in {"download", "downloads"}
    assert picker.picker_file_card(downloads_xml, "Synthetic_RMXP.zip") == (897, 735)
    assert current_picker_location('<hierarchy/>') == ""
    # A neighbouring original ZIP must never be selected instead of the SAF
    # export. In list mode picker_file_card returns the exact matching row.
    list_xml = ('<?xml version="1.0"?><hierarchy>'
                '<node resource-id="com.google.android.documentsui:id/item_root" '
                'class="android.widget.LinearLayout" bounds="[10,100][500,200]">'
                '<node resource-id="android:id/title" text="EssentialsSynthetic.zip" '
                'bounds="[50,110][320,150]" /></node>'
                '<node resource-id="com.google.android.documentsui:id/item_root" '
                'class="android.widget.LinearLayout" bounds="[10,210][500,310]">'
                '<node resource-id="android:id/title" text="Synthetic_RMXP.zip" '
                'bounds="[50,220][320,260]" /></node></hierarchy>')
    assert picker.picker_file_card(list_xml, "Synthetic_RMXP.zip") == (255, 260)
    assert picker.picker_file_card(list_xml, "not-present.zip") is None
    assert expected_member_paths("./projects/import-1", {
        "Game.rxproj": b"", "Data/Map001.rxdata": b"",
        "PBS/pokemon.txt": b"", "Graphics/Empty": b"",
    }) == {
        "./projects/import-1/Game.rxproj",
        "./projects/import-1/Data/Map001.rxdata",
        "./projects/import-1/PBS/pokemon.txt",
        "./projects/import-1/Graphics/Empty",
    }
    for unsafe in ("../Game.rxproj", "/Game.rxproj", "PBS//pokemon.txt",
                   r"Graphics\Tilesets\bad.png"):
        try:
            expected_member_paths("./projects/import-1", {unsafe: b""})
        except AssertionError:
            pass
        else:
            raise AssertionError(f"Accepted unsafe reimport member {unsafe!r}")
    assert one_new_path(
        {"./projects/import-1/Data/Map001.rxdata"},
        {"./projects/import-1/Data/Map001.rxdata", "./projects/import-2/Data/Map001.rxdata"},
    ) == "./projects/import-2/Data/Map001.rxdata"
    for before, after in (
        ({"a"}, {"a"}),
        ({"a"}, {"b"}),
        ({"a"}, {"a", "b", "c"}),
    ):
        try:
            one_new_path(before, after)
        except AssertionError:
            pass
        else:
            raise AssertionError(f"Accepted invalid reimport path delta: {before}, {after}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--package", default="com.xbaconator.essentialsstudiomobile")
    parser.add_argument("--evidence", type=Path, default=Path("android-runtime-evidence"))
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        selftest()
        print("Android SAF export reimport selector/path tests passed")
        return 0
    try:
        run(args.package, args.evidence)
    except Exception as exc:
        print(f"Android exported ZIP reimport NOT verified: {exc}")
        return 1
    print("Android emulator reimported its own SAF export with saved map SHA intact")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
