"""Native map-tree selection regression: never confuse headings with map buttons."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("android_portrait", ROOT / "scripts/android-emulator-ci-portrait.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

PKG = "com.xbaconator.essentialsstudiomobile"

def node(text, clickable="false", package=PKG, bounds="[10,20][110,80]"):
    return {"text": text, "clickable": clickable, "package": package,
            "bounds": bounds, "enabled": "true", "class": "android.widget.TextView"}

class ImportedMapSelection(unittest.TestCase):
    def test_ignores_static_heading_and_selects_app_owned_button(self):
        nodes = [node("Synthetic Map"), node("Synthetic Map", "true", bounds="[20,40][120,100]")]
        self.assertEqual(module.clickable_imported_map(nodes, PKG, "Synthetic Map"), (70, 70))

    def test_rejects_foreign_and_nonclickable_matches(self):
        for nodes in ([node("Synthetic Map")],
                      [node("Synthetic Map", "true", package="android")],
                      [node("Synthetic Map", "true", bounds="[0,0][0,0]")]):
            with self.subTest(nodes=nodes), self.assertRaises(AssertionError):
                module.clickable_imported_map(nodes, PKG, "Synthetic Map")

    def test_rejects_ambiguous_actionable_entries(self):
        with self.assertRaises(AssertionError):
            module.clickable_imported_map([node("Synthetic Map", "true"),
                                           node("Synthetic Map", "true")], PKG, "Synthetic Map")

if __name__ == "__main__":
    unittest.main()
