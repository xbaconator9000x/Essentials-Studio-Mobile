#!/usr/bin/env python3
"""Run the synthetic native project ZIP roundtrip and independent ZIP verifier."""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    with tempfile.TemporaryDirectory(prefix="essentials-project-roundtrip-") as directory:
        artifacts = Path(directory)
        env = os.environ.copy()
        env["PROJECT_ROUNDTRIP_ARTIFACT_DIR"] = str(artifacts)
        subprocess.run(
            [
                "cargo",
                "test",
                "--manifest-path",
                "src-tauri/Cargo.toml",
                "--lib",
                "--",
                "--nocapture",
            ],
            cwd=ROOT,
            env=env,
            check=True,
        )
        subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts/verify_project_roundtrip.py"),
                str(artifacts / "original.zip"),
                str(artifacts / "exported.zip"),
                "--allow-changed",
                "Data/Map001.rxdata",
            ],
            cwd=ROOT,
            check=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
