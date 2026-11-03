#!/usr/bin/env python3
"""Regression coverage for ambiguous RMXP ZIP directory/file layouts."""
import importlib.util
import tempfile
import unittest
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("roundtrip", ROOT / "scripts" / "verify_project_roundtrip.py")
roundtrip = importlib.util.module_from_spec(spec)
spec.loader.exec_module(roundtrip)


class FileDirectoryCollisionTests(unittest.TestCase):
    def check_archive(self, entries, should_fail):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "project.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Game.rxproj", "synthetic")
                for name, data in entries:
                    archive.writestr(name, data)
            with zipfile.ZipFile(path) as archive:
                if should_fail:
                    with self.assertRaisesRegex(ValueError, "shadows project directory|file/directory path collision"):
                        roundtrip._members(archive)
                else:
                    roundtrip._members(archive)

    def test_regular_file_shadows_implicit_parent(self):
        self.check_archive([("Data", "file"), ("Data/Map001.rxdata", "map")], True)

    def test_casefolded_parent_shadow(self):
        self.check_archive([("data", "file"), ("Data/Map001.rxdata", "map")], True)

    def test_explicit_directory_collides_with_file(self):
        self.check_archive([("Graphics", "file"), ("Graphics/", "")], True)

    def test_normal_implicit_directory_is_allowed(self):
        self.check_archive([("Data/Map001.rxdata", "map")], False)


if __name__ == "__main__":
    unittest.main()
