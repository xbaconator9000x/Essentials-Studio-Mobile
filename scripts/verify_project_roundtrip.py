#!/usr/bin/env python3
"""Independently verify byte-preserving RMXP/Essentials ZIP export.

Usage:
    python3 scripts/verify_project_roundtrip.py original.zip exported.zip
    python3 scripts/verify_project_roundtrip.py original.zip exported.zip \
        --allow-changed Data/Map001.rxdata

The input may contain a single enclosing project directory; the exported
archive may be rooted at Game.rxproj. No RPG Maker or Ruby runtime is needed.
This is a source-integrity check, NOT proof the project launches in Essentials.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import stat
import sys
import zipfile
from pathlib import Path


def _members(archive: zipfile.ZipFile) -> tuple[dict[str, zipfile.ZipInfo], set[str]]:
    infos = archive.infolist()
    names = [item.filename for item in infos]
    if len(names) != len(set(names)):
        raise ValueError("ZIP contains duplicate member names")

    if "Game.rxproj" in names:
        prefix = ""
    else:
        candidates = {
            name[: -len("Game.rxproj")]
            for name in names
            if name.endswith("/Game.rxproj")
        }
        if len(candidates) != 1:
            raise ValueError("ZIP must contain exactly one project root with Game.rxproj")
        prefix = candidates.pop()
        if prefix.count("/") > 4:
            raise ValueError("ZIP project root exceeds four wrapper directories")

    files: dict[str, zipfile.ZipInfo] = {}
    dirs: set[str] = set()
    folded: set[str] = set()
    wrapper_dirs = {
        "/".join(prefix.rstrip("/").split("/")[:depth]) + "/"
        for depth in range(1, prefix.count("/"))
    }
    for info in infos:
        name = info.filename
        mode = (info.external_attr >> 16) & 0xFFFF
        if stat.S_IFMT(mode) == stat.S_IFLNK:
            raise ValueError(f"ZIP contains a symlink: {name}")
        if not name.startswith(prefix):
            if info.is_dir() and name in wrapper_dirs:
                continue
            raise ValueError(f"ZIP contains files outside its project root: {name}")
        relative = name[len(prefix):]
        if not relative:
            continue  # Explicit outer directory is not part of the project.
        parts = relative.rstrip("/").split("/")
        if any(part in ("", ".", "..") for part in parts) or "\\" in relative:
            raise ValueError(f"ZIP contains an unsafe project path: {relative}")
        key = relative.casefold()
        if key in folded:
            raise ValueError(f"ZIP contains duplicate/case-colliding path: {relative}")
        folded.add(key)
        if info.is_dir():
            dirs.add(relative.rstrip("/"))
        else:
            files[relative] = info
    # ZIP allows a regular file to shadow a directory, even though no real
    # filesystem can materialize both. Reject these archives before reporting
    # successful preservation (including implicit parent directories).
    file_keys = {name.casefold() for name in files}
    directory_keys = {name.casefold() for name in dirs}
    for name in [*files, *dirs]:
        parts = name.split("/")
        for depth in range(1, len(parts)):
            parent = "/".join(parts[:depth]).casefold()
            if parent in file_keys:
                raise ValueError(f"ZIP file shadows project directory: {name}")
    if file_keys & directory_keys:
        raise ValueError("ZIP contains a file/directory path collision")
    if "Game.rxproj" not in files:
        raise ValueError("ZIP project root has no Game.rxproj file")
    return files, dirs


def _digest(archive: zipfile.ZipFile, member: zipfile.ZipInfo) -> str:
    digest = hashlib.sha256()
    # ZipFile.open verifies CRC when the complete member is consumed.
    with archive.open(member) as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _file_digest(path: Path) -> str:
    """Hash the entire archive without loading a potentially huge ZIP into RAM."""
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def verify_roundtrip(original: Path, exported: Path, allowed_changes: set[str] | None = None) -> dict:
    allowed = set(allowed_changes or ())
    for name in allowed:
        if not name or name.startswith("/") or "\\" in name or any(
            part in ("", ".", "..") for part in name.split("/")
        ):
            raise ValueError(f"Invalid --allow-changed project path: {name}")

    with zipfile.ZipFile(original) as source, zipfile.ZipFile(exported) as target:
        src_files, src_dirs = _members(source)
        dst_files, dst_dirs = _members(target)
        missing_dirs = sorted(src_dirs - dst_dirs)
        # Extraction/export materialises parent directories that were implicit
        # in the input ZIP, including parents of explicit nested directories.
        # Those are not new project content. A genuinely new
        # empty directory must still fail closed.
        implied_dirs = {
            "/".join(parts[:depth])
            for member in (*src_files, *src_dirs)
            for parts in [member.split("/")]
            for depth in range(1, len(parts))
        }
        added_dirs = sorted((dst_dirs - src_dirs) - implied_dirs)
        # An edit allowance permits changed bytes, not deletion of an original
        # project member. Otherwise an exported ZIP missing its only edited map
        # could be reported as verified despite losing gameplay data.
        missing_files = sorted(set(src_files) - set(dst_files))
        # An edit allowance never authorizes adding a new file. Require an
        # explicit manifest change review instead of silently blessing it.
        added_files = sorted(set(dst_files) - set(src_files))
        if missing_dirs or added_dirs or missing_files or added_files:
            raise ValueError(
                f"Project manifest changed: missing directories={missing_dirs}, "
                f"added directories={added_dirs}, "
                f"missing files={missing_files}, added files={added_files}"
            )

        # Hash every file, including approved edits, so corrupt ZIP payloads
        # still fail CRC validation. Only explicitly approved changes may differ.
        src_hashes = {name: _digest(source, info) for name, info in src_files.items()}
        dst_hashes = {name: _digest(target, info) for name, info in dst_files.items()}
        changed = sorted(
            name for name in src_files.keys() & dst_files.keys()
            if src_hashes[name] != dst_hashes[name]
        )
        unapproved = sorted(set(changed) - allowed)
        if unapproved:
            raise ValueError(f"Unapproved source-file byte changes: {unapproved}")
        return {
            "status": "verified",
            "input_sha256": _file_digest(original),
            "output_sha256": _file_digest(exported),
            "unchanged_files": len(src_files.keys() & dst_files.keys()) - len(changed),
            "approved_changed_files": changed,
            "input_files": len(src_files),
            "output_files": len(dst_files),
            "preserved_explicit_directories": len(src_dirs),
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("original", type=Path)
    parser.add_argument("exported", type=Path)
    parser.add_argument("--allow-changed", action="append", default=[], metavar="PROJECT/PATH")
    args = parser.parse_args()
    try:
        result = verify_roundtrip(args.original, args.exported, set(args.allow_changed))
    except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as exc:
        print(f"Project roundtrip verification failed: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
