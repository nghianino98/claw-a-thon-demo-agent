#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import zipfile
from pathlib import Path


EXCLUDED_DIRS = {".git", ".next", ".obsidian", ".vscode", ".sixth", "venv", "node_modules", "__pycache__"}
EXCLUDED_NAMES = {".DS_Store", ".greennode.json"}
MEDIA_EXTENSIONS = {".svg", ".png", ".jpg", ".jpeg"}


def excluded(path: Path, root: Path, no_media: bool) -> bool:
    rel = path.relative_to(root)
    parts = rel.parts
    lowered = path.name.lower()
    if any(part in EXCLUDED_DIRS for part in parts):
        return True
    if path.name in EXCLUDED_NAMES:
        return True
    if lowered.endswith(".pyc") or lowered.endswith(".sqlite3"):
        return True
    if ".env" in lowered or "credentials" in lowered:
        return True
    if no_media and path.suffix.lower() in MEDIA_EXTENSIONS:
        return True
    return False


def pack(source: Path, output: Path, no_media: bool) -> None:
    source = source.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    files = 0
    bytes_in = 0
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
        for dirpath, dirnames, filenames in os.walk(source):
            current = Path(dirpath)
            dirnames[:] = [name for name in dirnames if name not in EXCLUDED_DIRS]
            for filename in filenames:
                path = current / filename
                if path.is_symlink() or not path.is_file() or excluded(path, source, no_media):
                    continue
                arcname = path.relative_to(source).as_posix()
                zf.write(path, arcname)
                files += 1
                try:
                    bytes_in += path.stat().st_size
                except OSError:
                    pass
    print(f"packed files={files} bytes={bytes_in} output={output} size={output.stat().st_size}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--no-media", action="store_true")
    args = parser.parse_args()
    pack(Path(args.source), Path(args.output), args.no_media)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

