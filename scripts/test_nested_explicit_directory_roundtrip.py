#!/usr/bin/env python3
"""Regression tests for implicit ZIP directory parents during RMXP export."""
import tempfile
import unittest
import zipfile
from pathlib import Path

from verify_project_roundtrip import verify_roundtrip


def make_zip(path: Path, entries: dict[str, bytes]) -> None:
    with zipfile.ZipFile(path, "w") as archive:
        for name, payload in entries.items():
            archive.writestr(name, payload)


class ImplicitDirectoryParentTests(unittest.TestCase):
    def test_parent_of_original_explicit_empty_directory_is_allowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, exported = Path(tmp) / "original.zip", Path(tmp) / "exported.zip"
            make_zip(source, {"Game.rxproj": b"", "Graphics/Extra/Empty/": b""})
            make_zip(exported, {
                "Game.rxproj": b"",
                "Graphics/": b"",
                "Graphics/Extra/": b"",
                "Graphics/Extra/Empty/": b"",
            })
            result = verify_roundtrip(source, exported)
            self.assertEqual(result["status"], "verified")
            self.assertEqual(result["preserved_explicit_directories"], 1)

    def test_unrelated_new_empty_directory_still_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, exported = Path(tmp) / "original.zip", Path(tmp) / "exported.zip"
            make_zip(source, {"Game.rxproj": b"", "Graphics/Extra/Empty/": b""})
            make_zip(exported, {
                "Game.rxproj": b"",
                "Graphics/": b"",
                "Graphics/Extra/": b"",
                "Graphics/Extra/Empty/": b"",
                "Graphics/Unexpected/": b"",
            })
            with self.assertRaisesRegex(ValueError, "added directories"):
                verify_roundtrip(source, exported)

    def test_missing_original_explicit_empty_directory_still_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, exported = Path(tmp) / "original.zip", Path(tmp) / "exported.zip"
            make_zip(source, {"Game.rxproj": b"", "Graphics/Extra/Empty/": b""})
            make_zip(exported, {"Game.rxproj": b"", "Graphics/": b"", "Graphics/Extra/": b""})
            with self.assertRaisesRegex(ValueError, "missing directories"):
                verify_roundtrip(source, exported)


if __name__ == "__main__":
    unittest.main()
