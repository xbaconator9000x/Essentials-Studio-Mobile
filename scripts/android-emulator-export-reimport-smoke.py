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


def one_new_path(before: set[str], after: set[str]) -> str:
    if not before.issubset(after):
        raise AssertionError(f"An existing imported project disappeared: {sorted(before-after)}")
    new = after - before
    if len(new) != 1:
        raise AssertionError(f"Expected exactly one newly imported map, got {sorted(new)!r}")
    return next(iter(new))


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
        if not picker.try_external_storage_download(evidence, export_helper.EXPORT_FILENAME):
            raise AssertionError("Native DocumentsUI did not select exported ZIP")
        if not picker.wait_for_editor(evidence, 45):
            raise AssertionError("Exported project did not reopen in Android editor")
        nodes = picker.dump_ui(evidence, "reimport-editor-after")
        if not picker.editor_visible(nodes):
            raise AssertionError("Reimport did not display an open project")

        after = private_map_paths(package)
        path = one_new_path(before, after)
        map_bytes = map_helper.read_private_map(package, path)
        map_sha = hashlib.sha256(map_bytes).hexdigest()
        if map_sha != painted["map_sha256_after"]:
            raise AssertionError("Reimported map bytes differ from the on-device saved map")
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
