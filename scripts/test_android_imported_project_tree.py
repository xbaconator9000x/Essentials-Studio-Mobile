#!/usr/bin/env python3
"""Regression for the native Android synthetic-project overview contract."""
import importlib.util
from pathlib import Path
import unittest

SCRIPT = Path(__file__).with_name("android-emulator-ci-portrait.py")
spec = importlib.util.spec_from_file_location("android_portrait", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportedProjectTreeTests(unittest.TestCase):
    def test_requires_project_and_map_from_our_app(self):
        package = "com.xbaconator.essentialsstudiomobile"
        project = {"package": package, "text": "Synthetic RMXP", "content-desc": ""}
        map_node = {"package": package, "text": "🗺 [001] Synthetic Map", "content-desc": ""}
        self.assertTrue(module.imported_project_tree_ready([project, map_node], package))
        self.assertFalse(module.imported_project_tree_ready([project], package))
        self.assertFalse(module.imported_project_tree_ready([map_node], package))
        self.assertFalse(module.imported_project_tree_ready(
            [project, {"package": "com.android.documentsui", "text": "Synthetic Map"}], package))
        self.assertFalse(module.imported_project_tree_ready(
            [map_node, {"package": "com.android.documentsui", "text": "Synthetic RMXP"}], package))

    def test_obsolete_summary_and_toast_are_not_success(self):
        package = "com.xbaconator.essentialsstudiomobile"
        nodes = [{"package": package, "text": "1 maps available"},
                 {"package": package, "text": "Project ZIP import cancelled"}]
        self.assertFalse(module.imported_project_tree_ready(nodes, package))


if __name__ == "__main__":
    unittest.main()
