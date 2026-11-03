#!/usr/bin/env python3
"""Regression tests for strict ZIP roundtrip evidence."""
import importlib.util
import stat
import tempfile
import unittest
import zipfile
from pathlib import Path

spec = importlib.util.spec_from_file_location(
    "verify_project_roundtrip", Path(__file__).with_name("verify_project_roundtrip.py")
)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class RoundtripSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = self.root / "original.zip"
        self.exported = self.root / "exported.zip"

    def write(self, path, files, symlink=None):
        with zipfile.ZipFile(path, "w") as archive:
            for name, payload in files.items():
                archive.writestr(name, payload)
            if symlink:
                entry = zipfile.ZipInfo(symlink)
                entry.create_system = 3
                entry.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(entry, "Data/Map001.rxdata")

    def test_identical_archive_returns_hash_receipts(self):
        files = {"Game.rxproj": b"RMXP", "Data/Map001.rxdata": b"map"}
        self.write(self.original, files)
        self.write(self.exported, files)
        receipt = verifier.verify_roundtrip(self.original, self.exported)
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual(len(receipt["input_sha256"]), 64)
        self.assertEqual(receipt["input_sha256"], receipt["output_sha256"])

    def test_allowed_change_cannot_add_member(self):
        self.write(self.original, {"Game.rxproj": b"RMXP"})
        self.write(self.exported, {"Game.rxproj": b"RMXP", "Data/Map001.rxdata": b"new"})
        with self.assertRaisesRegex(ValueError, "added files"):
            verifier.verify_roundtrip(self.original, self.exported, {"Data/Map001.rxdata"})

    def test_reject_symlink_in_source(self):
        self.write(self.original, {"Game.rxproj": b"RMXP"}, symlink="Data/link")
        self.write(self.exported, {"Game.rxproj": b"RMXP"})
        with self.assertRaisesRegex(ValueError, "symlink"):
            verifier.verify_roundtrip(self.original, self.exported)

    def test_reject_symlink_in_output(self):
        self.write(self.original, {"Game.rxproj": b"RMXP"})
        self.write(self.exported, {"Game.rxproj": b"RMXP"}, symlink="Data/link")
        with self.assertRaisesRegex(ValueError, "symlink"):
            verifier.verify_roundtrip(self.original, self.exported)


if __name__ == "__main__":
    unittest.main()
