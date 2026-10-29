import tempfile
import unittest
import zipfile
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from verify_project_roundtrip import verify_roundtrip


class ProjectRoundtripTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def make_zip(self, name, entries):
        path = self.root / name
        with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for member, data in entries:
                archive.writestr(member, data)
        return path

    def sample(self, prefix=""):
        return [
            (prefix + "Game.rxproj", b"RPGXP 1.02"),
            (prefix + "Data/Map001.rxdata", bytes([0, 255, 1, 2])),
            (prefix + "Data/Scripts.rxdata", bytes([4, 8, 99, 0])),
            (prefix + "PBS/pokemon.txt", b"# preserve\r\n[TEST]\r\nName = Test\r\n"),
            (prefix + "Graphics/Tilesets/Forest.png", b"\x89PNG\x00\x01"),
            (prefix + "Graphics/Empty/", b""),
        ]

    def test_nested_input_root_reopens_as_flat_export_without_byte_changes(self):
        original = self.make_zip("original.zip", self.sample("MyGame/"))
        exported = self.make_zip("export.zip", self.sample())
        report = verify_roundtrip(original, exported)
        self.assertEqual(report["status"], "verified")
        self.assertEqual(report["unchanged_files"], 5)
        self.assertEqual(report["preserved_explicit_directories"], 1)

    def test_targeted_map_edit_requires_explicit_allowance_and_preserves_other_files(self):
        original = self.make_zip("original.zip", self.sample())
        modified = [
            (name, b"changed tiles" if name == "Data/Map001.rxdata" else data)
            for name, data in self.sample()
        ]
        exported = self.make_zip("export.zip", modified)
        with self.assertRaisesRegex(ValueError, "Unapproved source-file byte changes"):
            verify_roundtrip(original, exported)
        report = verify_roundtrip(original, exported, {"Data/Map001.rxdata"})
        self.assertEqual(report["approved_changed_files"], ["Data/Map001.rxdata"])
        self.assertEqual(report["unchanged_files"], 4)

    def test_lost_pbs_script_and_empty_directory_are_rejected(self):
        original = self.make_zip("original.zip", self.sample())
        for index, omitted in enumerate(("PBS/pokemon.txt", "Data/Scripts.rxdata", "Graphics/Empty/")):
            exported = self.make_zip(
                f"lost-{index}.zip",
                [(name, data) for name, data in self.sample() if name != omitted],
            )
            with self.assertRaisesRegex(ValueError, "Project manifest changed"):
                verify_roundtrip(original, exported)

    def test_unapproved_new_files_are_not_silently_accepted(self):
        original = self.make_zip("original.zip", self.sample())
        exported = self.make_zip("export.zip", self.sample() + [("PBS/new.txt", b"new")])
        with self.assertRaisesRegex(ValueError, "added files"):
            verify_roundtrip(original, exported)
        report = verify_roundtrip(original, exported, {"PBS/new.txt"})
        self.assertEqual(report["output_files"], 6)

    def test_duplicate_zip_names_and_outside_root_are_rejected(self):
        original = self.make_zip("original.zip", self.sample())
        duplicate = self.make_zip("duplicate.zip", self.sample() + [("Data/Map001.rxdata", b"duplicate")])
        with self.assertRaisesRegex(ValueError, "duplicate"):
            verify_roundtrip(original, duplicate)
        outside = self.make_zip("outside.zip", self.sample("MyGame/") + [("unrelated.txt", b"outside")])
        with self.assertRaisesRegex(ValueError, "outside its project root"):
            verify_roundtrip(outside, original)

    def test_corrupted_zip_payload_is_detected_even_for_allowed_edits(self):
        original = self.make_zip("original.zip", self.sample())
        exported = self.make_zip("export.zip", self.sample())
        # Replace one byte of the compressed stream, preserving ZIP metadata.
        payload = bytearray(exported.read_bytes())
        with zipfile.ZipFile(exported) as archive:
            info = archive.getinfo("PBS/pokemon.txt")
            offset = info.header_offset + 30 + len(info.filename.encode()) + len(info.extra)
        payload[offset + 2] ^= 0xFF
        exported.write_bytes(payload)
        with self.assertRaises((zipfile.BadZipFile, RuntimeError, OSError)):
            verify_roundtrip(original, exported, {"PBS/pokemon.txt"})


if __name__ == "__main__":
    unittest.main()
