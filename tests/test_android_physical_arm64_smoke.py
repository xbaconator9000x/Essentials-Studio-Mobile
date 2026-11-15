"""Offline host contract tests for real ARM64 APK smoke; no Android device required."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "physical_arm64_smoke", ROOT / "scripts/android-physical-arm64-smoke.py")
assert SPEC and SPEC.loader
harness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harness)


class PhysicalArm64SmokeTests(unittest.TestCase):
    def test_requires_exactly_one_authorized_device(self):
        single = "List of devices attached\nR3DEVICE device product:pixel\n"
        self.assertEqual(harness.choose_device(single, None), "R3DEVICE")
        multiple = single + "ANOTHER device product:pixel\n"
        with self.assertRaisesRegex(RuntimeError, "exactly one"):
            harness.choose_device(multiple, None)
        self.assertEqual(harness.choose_device(multiple, "ANOTHER"), "ANOTHER")
        with self.assertRaisesRegex(RuntimeError, "not authorized"):
            harness.choose_device("List of devices attached\nR3DEVICE unauthorized\n", "R3DEVICE")
        with self.assertRaises(RuntimeError):
            harness.choose_device("List of devices attached\n", None)

    def test_requires_app_owned_android_accessibility_not_a_system_picker(self):
        xml = (b'<?xml version="1.0" encoding="UTF-8"?>'
               b'<hierarchy><node package="com.android.documentsui" text="Projects" />'
               b'<node package="com.xbaconator.essentialsstudiomobile" '
               b'text="Import Essentials Project ZIP" /></hierarchy>')
        owned, labels = harness.parse_ui(xml)
        self.assertTrue(owned)
        self.assertTrue(harness.ui_is_editor(owned, labels))
        ui = (b'<?xml version="1.0"?><hierarchy>'
              b'<node package="com.android.documentsui" text="Projects" />'
              b'</hierarchy>')
        self.assertFalse(harness.ui_is_editor(*harness.parse_ui(ui)))
        self.assertFalse(harness.ui_is_editor(True, ["Unrelated app window"]))
        with self.assertRaisesRegex(RuntimeError, "no XML"):
            harness.parse_ui(b"empty")

    def test_capture_must_be_valid_png_with_nonzero_geometry(self):
        data = (harness.PNG_SIGNATURE + bytes(8)
                + (412).to_bytes(4, "big") + (915).to_bytes(4, "big"))
        self.assertEqual(harness.check_png(data), (412, 915))
        with self.assertRaisesRegex(RuntimeError, "invalid PNG"):
            harness.check_png(b"not-an-image")
        with self.assertRaisesRegex(RuntimeError, "invalid dimensions"):
            harness.check_png(harness.PNG_SIGNATURE + bytes(8)
                              + (0).to_bytes(4, "big") + (915).to_bytes(4, "big"))


if __name__ == "__main__":
    unittest.main()
