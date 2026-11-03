"""Synthetic, rights-cleared ZIP integrity regression tests."""
import hashlib
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

SCRIPT = Path(__file__).with_name("verify_project_roundtrip.py")
spec = importlib.util.spec_from_file_location("verify_project_roundtrip", SCRIPT)
verifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verifier)


class ManifestAndReceiptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.original = self.root / "original.zip"
        self.exported = self.root / "exported.zip"

    def make_zip(self, path, members):
        with zipfile.ZipFile(path, "w") as archive:
            for name, data in members.items():
                archive.writestr(name, data)

    def test_added_empty_directory_is_rejected(self):
        members = {"Game.rxproj": b"synthetic", "Data/Map001.rxdata": b"map"}
        self.make_zip(self.original, members)
        self.make_zip(self.exported, {**members, "Unexpected/": b""})
        with self.assertRaisesRegex(ValueError, "added directories"):
            verifier.verify_roundtrip(self.original, self.exported)

    def test_preserved_directories_and_streamed_archive_receipts(self):
        members = {"Game.rxproj": b"synthetic", "Data/": b"", "Data/Map001.rxdata": b"map"}
        self.make_zip(self.original, members)
        self.make_zip(self.exported, members)
        receipt = verifier.verify_roundtrip(self.original, self.exported)
        self.assertEqual(receipt["status"], "verified")
        self.assertEqual(receipt["preserved_explicit_directories"], 1)
        for key, path in (("input_sha256", self.original), ("output_sha256", self.exported)):
            with path.open("rb") as stream:
                self.assertEqual(receipt[key], hashlib.file_digest(stream, "sha256").hexdigest())

    def test_allowed_map_edit_does_not_allow_extra_directory(self):
        members = {"Game.rxproj": b"synthetic", "Data/Map001.rxdata": b"old"}
        self.make_zip(self.original, members)
        self.make_zip(self.exported, {**members, "Data/Map001.rxdata": b"new", "Extra/": b""})
        with self.assertRaisesRegex(ValueError, "added directories"):
            verifier.verify_roundtrip(self.original, self.exported, {"Data/Map001.rxdata"})


if __name__ == "__main__":
    unittest.main()
