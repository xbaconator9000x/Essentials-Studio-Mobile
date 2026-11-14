#!/usr/bin/env python3
"""Host-side guards for the real Android emulator UI harness.

These tests check selector, off-screen and fixture-integrity invariants.
They are NOT substitutes for real emulator boot / orientation evidence.
"""
import base64
import hashlib
import importlib.util
import io
from pathlib import Path
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "essentials_android_emulator_harness",
    ROOT / "scripts/android-emulator-ci-portrait.py",
)
assert SPEC and SPEC.loader
harness = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(harness)


class AndroidEmulatorHarnessTests(unittest.TestCase):
    def test_real_welcome_accessibility_selector(self):
        nodes = [
            {"class": "android.widget.TextView", "text": "Import Essentials Project ZIP",
             "bounds": "[0,40][400,80]", "enabled": "true"},
            {"class": "android.widget.Button",
             "text": "Choose Essentials Project ZIP: No file chosen",
             "clickable": "true", "bounds": "[10,100][390,160]", "enabled": "true"},
            {"class": "android.widget.Button",
             "text": "Use native Android document picker",
             "clickable": "true", "bounds": "[10,190][390,250]", "enabled": "true"},
        ]
        self.assertEqual(harness.action(nodes, "Use native Android document picker"), (200, 220))
        self.assertEqual(harness.action(nodes, "Choose Essentials Project ZIP"), (200, 130))
        self.assertIsNone(harness.action(nodes, "Import Essentials Project ZIP"))
        harness.assert_visible_controls(
            nodes, ("Use native Android document picker", "Choose Essentials Project ZIP"),
            (400, 850),
        )

    def test_disabled_or_clipped_controls_never_pass(self):
        nodes = [{"class": "android.widget.Button", "text": "Save",
                  "clickable": "true", "bounds": "[10,15][60,65]",
                  "enabled": "false"}]
        self.assertIsNone(harness.action(nodes, "Save"))
        nodes[0]["enabled"] = "true"
        with self.assertRaisesRegex(AssertionError, "outside"):
            harness.assert_visible_controls(nodes, ("Save",), (40, 40))
        nodes[0]["bounds"] = "[10,15][30,38]"
        harness.assert_visible_controls(nodes, ("Save",), (40, 40))

    def test_launcher_anr_cannot_be_misidentified_as_editor_anr(self):
        package = "com.xbaconator.essentialsstudiomobile"
        system_overlay = (
            f"mFocusedApp=ActivityRecord{{... {package}/.MainActivity}}\\n"
            "mFocusedWindow=Window{5e0317 u0 Application Not Responding: "
            "com.google.android.apps.nexuslauncher}\\n"
            f"ResumedActivity: {package}/.MainActivity\\n"
        )
        self.assertEqual(harness.focused_anr_owner(system_overlay),
                         "com.google.android.apps.nexuslauncher")
        self.assertEqual(harness.focused_anr_owner(system_overlay.replace(
            "com.google.android.apps.nexuslauncher", package)), package)
        self.assertIsNone(harness.focused_anr_owner(
            f"mFocusedApp=ActivityRecord{{... {package}}}\\n"
            f"mFocusedWindow=Window{{5e0317 u0 Splash Screen {package}}}\\n"
        ))

    def test_verified_synthetic_fixture_is_nonprivate_and_exact(self):
        lines = (ROOT / "tests/fixtures/android-synthetic-project.zip.b64").read_text().splitlines()
        data = base64.b64decode("".join(
            line.strip() for line in lines if line.strip() and not line.startswith("#")
        ), validate=True)
        self.assertEqual(
            hashlib.sha256(data).hexdigest(),
            "60c78b3171a0b4fc1dc96260cd8d8240374dc214dd282779f8ff49ade2c000bb",
        )
        with zipfile.ZipFile(io.BytesIO(data)) as source:
            names = source.namelist()
            self.assertTrue(any(name.endswith("Game.rxproj") for name in names))
            self.assertTrue(any(name.endswith("Data/Map001.rxdata") for name in names))
            self.assertTrue(any(name.endswith("Graphics/Tilesets/Synthetic.png") for name in names))
            self.assertFalse(any(".." in name.split("/") or name.startswith("/") for name in names))


if __name__ == "__main__":
    unittest.main()
