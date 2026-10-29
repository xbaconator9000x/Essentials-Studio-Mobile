"""Receipt generation for rights-cleared synthetic project ZIP CI evidence."""
import hashlib
import json
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from run_project_roundtrip import publish_verified_evidence


class RoundtripEvidenceTests(unittest.TestCase):
    def test_receipt_hashes_match_published_zip_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "generated"
            source.mkdir()
            for name, data in (("original.zip", b"original"), ("exported.zip", b"exported")):
                with zipfile.ZipFile(source / name, "w") as archive:
                    archive.writestr("Game.rxproj", data)
            report = {"status": "verified", "unchanged_files": 1}
            output = root / "published"
            receipt = publish_verified_evidence(source, output, report)
            self.assertEqual(receipt["verification"], report)
            self.assertEqual(receipt["allowed_changed_paths"], ["Data/Map001.rxdata"])
            self.assertIn("physical Android SAF provider", receipt["unverified_gates"])
            self.assertEqual(json.loads((output / "receipt.json").read_text()), receipt)
            for name in ("original.zip", "exported.zip"):
                content = (output / name).read_bytes()
                self.assertEqual(receipt["archives"][name]["sha256"], hashlib.sha256(content).hexdigest())
                self.assertEqual(content, (source / name).read_bytes())

    def test_missing_zip_does_not_publish_partial_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "generated"
            source.mkdir()
            (source / "original.zip").write_bytes(b"original")
            output = root / "published"
            with self.assertRaises(FileNotFoundError):
                publish_verified_evidence(source, output, {"status": "verified"})
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
