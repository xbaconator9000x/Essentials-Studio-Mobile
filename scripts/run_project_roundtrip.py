#!/usr/bin/env python3
"""Run the synthetic native project ZIP roundtrip and independent ZIP verifier."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def publish_verified_evidence(artifacts: Path, destination: Path, report: dict) -> dict:
    """Publish only the native test's synthetic ZIPs after verification passes.

    This receipt proves source-level byte integrity, not Android SAF, desktop
    RPG Maker reopening or JoiPlay/NaviaXP gameplay compatibility.
    """
    source = artifacts / "original.zip"
    target = artifacts / "exported.zip"
    # Validate both inputs before creating a destination or copying anything.
    if not source.is_file() or not target.is_file():
        raise FileNotFoundError("Native roundtrip did not produce both synthetic ZIPs")
    destination.mkdir(parents=True, exist_ok=True)
    receipt = {
        "fixture": "rights-cleared synthetic RMXP project (not Shattered)",
        "commit": os.environ.get("GITHUB_SHA", "local"),
        "run_id": os.environ.get("GITHUB_RUN_ID", "local"),
        "allowed_changed_paths": ["Data/Map001.rxdata", "PBS/pokemon.txt"],
        "verification": report,
        "archives": {},
        "unverified_gates": ["physical Android SAF provider", "desktop RMXP reopen", "JoiPlay/NaviaXP playtest"],
    }
    for name, original in (("original.zip", source), ("exported.zip", target)):
        copied = destination / name
        shutil.copyfile(original, copied)
        digest = hashlib.sha256()
        with copied.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        receipt["archives"][name] = {"sha256": digest.hexdigest(), "size": copied.stat().st_size}
    (destination / "receipt.json").write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    return receipt


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
        result = subprocess.run(
            [
                sys.executable,
                str(ROOT / "scripts/verify_project_roundtrip.py"),
                str(artifacts / "original.zip"),
                str(artifacts / "exported.zip"),
                "--allow-changed",
                "Data/Map001.rxdata",
                "--allow-changed",
                "PBS/pokemon.txt",
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )
        print(result.stdout, end="")
        evidence_dir = os.environ.get("PROJECT_ROUNDTRIP_EVIDENCE_DIR")
        if evidence_dir:
            publish_verified_evidence(artifacts, Path(evidence_dir), json.loads(result.stdout))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
