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
from unittest.mock import patch
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

    def test_actual_map_taps_target_source_tiles_not_the_blank_canvas(self):
        package = "com.xbaconator.essentialsstudiomobile"
        nodes = [
            {"package": "com.android.documentsui",
             "content-desc": "Map tile editing canvas", "bounds": "[0,0][900,900]"},
            {"package": package, "content-desc": "Map tile editing canvas",
             "class": "android.view.View", "enabled": "true",
             "bounds": "[0,709][1080,2120]"},
            # The actual WebView combines 2x2 and Layer in one text node.
            {"package": package, "text": "Map [001] 2x2Layer 1/3Tile: 393"},
        ]
        points = harness.map_canvas_tap_points(nodes, package, 440)
        self.assertEqual(points, [(132, 841), (132, 753), (44, 841), (44, 753)])
        self.assertTrue(all(0 < x < 176 and 709 < y < 885 for x, y in points))
        # The previous algorithm picked 18%-60% of a 1080x1411 canvas.
        # Every such point missed this real 2x2 map.
        with self.assertRaisesRegex(AssertionError, "Expected one accessible"):
            harness.map_canvas_tap_points(nodes[:1], package, 440)
        with self.assertRaisesRegex(AssertionError, "Expected one accessible"):
            harness.map_canvas_tap_points(nodes + [nodes[1]], package, 440)
        with self.assertRaisesRegex(AssertionError, "Could not identify one map size"):
            harness.map_canvas_tap_points(nodes[:2], package, 440)
        with self.assertRaisesRegex(AssertionError, "Invalid Android screen density"):
            harness.map_canvas_tap_points(nodes, package, 0)

    def test_small_native_map_tile_centres_use_live_density_and_map_size(self):
        package = "com.xbaconator.essentialsstudiomobile"
        nodes = [
            {"package": package, "text": "Map [042] 1x3Layer 2/3Tile: 385"},
            {"package": package, "content-desc": "Map tile editing canvas",
             "bounds": "[12,400][400,1100]"},
        ]
        self.assertEqual(harness.map_canvas_tap_points(nodes, package, 320),
                         [(44, 560), (44, 432)])

    def test_native_private_map_witness_refuses_unrelated_or_multiple_files(self):
        valid = "./files/projects/import-1234/Data/Map001.rxdata"
        self.assertEqual(harness.private_imported_map_path(valid + "\n"), valid)
        with self.assertRaisesRegex(AssertionError, "Expected one app-private"):
            harness.private_imported_map_path(
                valid + "\n./files/projects/import-5678/Data/Map001.rxdata\n"
            )
        for invalid in (
            "", "./files/projects/other/Data/Map001.rxdata",
            "./files/import-123/Data/Map001.rxdata",
            "/sdcard/Download/Data/Map001.rxdata",
            "../private/projects/import-1/Data/Map001.rxdata",
            "./files/projects/import-1/Data/Map002.rxdata",
        ):
            with self.subTest(path=invalid):
                with self.assertRaisesRegex(AssertionError, "Expected one app-private"):
                    harness.private_imported_map_path(invalid)

    def test_native_edit_receipt_needs_real_app_owned_unsaved_status(self):
        package = "com.xbaconator.essentialsstudiomobile"
        app = {"package": package, "text": "1 unsaved", "enabled": "true"}
        self.assertTrue(harness.has_unsaved_map([app], package))
        self.assertFalse(harness.has_unsaved_map([
            {"package": "com.android.documentsui", "text": "1 unsaved"}], package))
        self.assertFalse(harness.has_unsaved_map([
            {"package": package, "text": "Saved"}], package))
        self.assertFalse(harness.has_unsaved_map([
            {"package": package, "text": "0 unsaved"}], package))

    def test_saved_map_navigation_reopens_collapsed_context_tools(self):
        # The Save All receipt leaves the map's disclosure collapsed. Reopening
        # through open_map_tools must restore the actual Choose another map
        # control before the native test taps it.
        collapsed = [{"class": "android.widget.Button", "text": "Show map tools",
                      "bounds": "[10,10][120,60]", "enabled": "true",
                      "clickable": "true"}]
        expanded = collapsed + [
            {"class": "android.widget.Button", "text": "Enable map editing",
             "bounds": "[10,70][160,120]", "enabled": "true", "clickable": "true"},
            {"class": "android.widget.Button", "text": "Choose another map",
             "bounds": "[10,130][160,180]", "enabled": "true", "clickable": "true"},
        ]
        with patch.object(harness, "ui_nodes", side_effect=[collapsed, expanded]), \
             patch.object(harness, "wait_ui", return_value=collapsed), \
             patch.object(harness, "tap_button") as tapped:
            result = harness.open_map_tools("native-map-before-reopen", timeout=2)
        tapped.assert_called_once_with(collapsed, "Show map tools")
        self.assertEqual(harness.action(result, "Choose another map"), (85, 155))

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
