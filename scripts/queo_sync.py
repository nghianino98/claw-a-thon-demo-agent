#!/usr/bin/env python3
import argparse
import hashlib
import io
import json
import os
import socket
import sys
import time
import zipfile
from pathlib import Path
from typing import Any

import httpx

try:
    from watchdog.observers import Observer
    from watchdog.events import FileSystemEventHandler
except ImportError:
    Observer = None
    FileSystemEventHandler = object

EXCLUDED_DIRS = {".git", ".next", ".obsidian", ".vscode", ".sixth", "venv", "node_modules", "__pycache__"}
EXCLUDED_NAMES = {".DS_Store", ".greennode.json"}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(64 * 1024):
            h.update(chunk)
    return h.hexdigest()


def is_excluded(path: Path, root: Path) -> bool:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return True
    parts = rel.parts
    if any(part in EXCLUDED_DIRS for part in parts):
        return True
    if not parts:
        return True
    name = parts[-1]
    low_name = name.lower()
    if name in EXCLUDED_NAMES:
        return True
    if low_name.endswith(".pyc") or low_name.endswith(".sqlite3"):
        return True
    if ".env" in low_name or "credentials" in low_name:
        return True
    return False


def get_local_manifest(root: Path) -> dict[str, dict[str, Any]]:
    manifest = {}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in EXCLUDED_DIRS and not d.startswith(".git")]
        for filename in filenames:
            path = Path(dirpath) / filename
            if is_excluded(path, root):
                continue
            if not path.is_file() or path.is_symlink():
                continue
            try:
                rel = path.relative_to(root).as_posix()
                size = path.stat().st_size
                sha = sha256_file(path)
                manifest[rel] = {"sha256": sha, "size": size}
            except Exception:
                pass
    return manifest


def perform_sync(url: str, key: str, sync_dir: Path, dry_run: bool = False) -> bool:
    print(f"🔄 Starting sync for: {sync_dir.resolve()}")
    if not sync_dir.exists():
        print(f"❌ Error: Directory {sync_dir} does not exist.")
        return False

    client = httpx.Client(timeout=30)
    headers = {"X-Sync-Api-Key": key}
    
    # 1. Fetch remote manifest
    manifest_url = f"{url.rstrip('/')}/admin/api/kb/manifest"
    try:
        resp = client.get(manifest_url, headers=headers)
        if resp.status_code == 401:
            print("❌ Authentication failed (401 Unauthorized). Check your X-Sync-Api-Key.")
            return False
        resp.raise_for_status()
        remote_data = resp.json()
    except Exception as e:
        print(f"❌ Failed to fetch remote manifest: {e}")
        return False

    base_version = remote_data.get("kb_version")
    if base_version is None:
        print("❌ Remote KB has no active version. Please run a full build/upload first.")
        return False

    remote_files = remote_data.get("files") or {}
    local_files = get_local_manifest(sync_dir)

    # 2. Compare local vs remote
    deleted = []
    added_modified = []
    
    for path, meta in remote_files.items():
        if path not in local_files:
            deleted.append(path)

    for path, meta in local_files.items():
        remote_meta = remote_files.get(path)
        if not remote_meta or remote_meta["sha256"] != meta["sha256"] or remote_meta["size"] != meta["size"]:
            added_modified.append(path)

    if not deleted and not added_modified:
        print("✅ Directory is fully synchronized. No changes detected.")
        return True

    print(f"📋 Changes detected: Added/Modified: {len(added_modified)}, Deleted: {len(deleted)}")

    if len(deleted) > 0 and len(remote_files) > 0 and len(deleted) > 0.3 * len(remote_files):
        print("⚠️ Protection trigger: Too many deletions (>30% of total files). Cancelled. Use full upload.")
        return False

    # 3. Create zip of added/modified files
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
        for rel_path in added_modified:
            full_path = sync_dir / rel_path
            zf.write(full_path, rel_path)
    zip_bytes = zip_buffer.getvalue()

    # 4. Compute target manifest checksum
    target_manifest = {}
    for path, meta in remote_files.items():
        if path not in deleted:
            target_manifest[path] = meta
    for path in added_modified:
        target_manifest[path] = local_files[path]

    sorted_manifest = {k: v for k, v in sorted(target_manifest.items())}
    manifest_json = json.dumps(sorted_manifest, separators=(",", ":"), sort_keys=True)
    client_manifest_sha = hashlib.sha256(manifest_json.encode("utf-8")).hexdigest()

    # 5. Build meta
    meta_payload = {
        "base_version": base_version,
        "client_host": socket.gethostname(),
        "deleted": deleted,
        "added_modified": added_modified,
        "client_manifest_sha": client_manifest_sha
    }

    if dry_run:
        print("🧪 Dry run enabled. No delta upload will be sent.")
        print(json.dumps({
            "base_version": base_version,
            "added_modified": added_modified,
            "deleted": deleted,
            "archive_bytes": len(zip_bytes),
            "client_manifest_sha": client_manifest_sha,
        }, ensure_ascii=False, indent=2))
        return True

    # 6. Upload delta
    delta_url = f"{url.rstrip('/')}/admin/api/kb/delta"
    files = {"archive": ("delta.zip", zip_bytes, "application/zip")}
    data = {"meta": json.dumps(meta_payload)}

    try:
        resp = client.post(delta_url, headers=headers, data=data, files=files, timeout=60)
        if resp.status_code == 200:
            print(f"✅ Delta sync succeeded: {resp.json()}")
            return True
        else:
            print(f"❌ Delta sync failed ({resp.status_code}): {resp.text}")
            return False
    except Exception as e:
        print(f"❌ Failed to upload delta sync: {e}")
        return False


class SyncHandler(FileSystemEventHandler):
    def __init__(self, debounce_seconds: float, callback):
        self.debounce_seconds = debounce_seconds
        self.callback = callback
        self.last_change = 0.0
        self.needs_sync = False

    def on_any_event(self, event):
        if event.is_directory:
            return
        # Skip if event path matches exclusion rules
        path = Path(event.src_path)
        # We need a dummy root for exclusion check, we can use current directory
        if is_excluded(path, path.parent.parent):
            return
        
        self.last_change = time.time()
        self.needs_sync = True


def main():
    parser = argparse.ArgumentParser(description="Quéo Solution KB Sync Client")
    parser.add_argument("--url", default=os.getenv("KB_SYNC_URL", "http://localhost:8000"), help="Agent URL")
    parser.add_argument("--key", default=os.getenv("KB_SYNC_KEY", ""), help="X-Sync-Api-Key token")
    parser.add_argument("--dir", default=".", help="Directory to sync")
    parser.add_argument("--once", action="store_true", help="Sync once and exit")
    parser.add_argument("--watch", action="store_true", help="Sync continuously using watchdog")
    parser.add_argument("--dry-run", action="store_true", help="Compare and print the delta without uploading it")
    args = parser.parse_args()

    sync_dir = Path(args.dir)
    if not args.key:
        print("❌ Error: X-Sync-Api-Key must be provided via --key or KB_SYNC_KEY environment variable.")
        sys.exit(1)

    if args.once or (not args.watch):
        success = perform_sync(args.url, args.key, sync_dir, dry_run=args.dry_run)
        sys.exit(0 if success else 1)

    if args.watch:
        if Observer is None:
            print("❌ Error: --watch requires the optional 'watchdog' package. Use --once/--dry-run or install watchdog.")
            sys.exit(1)
        print(f"👀 Watching directory: {sync_dir.resolve()}")
        handler = SyncHandler(debounce_seconds=2.0, callback=lambda: perform_sync(args.url, args.key, sync_dir, dry_run=args.dry_run))

        # Run initial sync
        perform_sync(args.url, args.key, sync_dir, dry_run=args.dry_run)

        observer = Observer()
        observer.schedule(handler, str(sync_dir), recursive=True)
        observer.start()

        try:
            while True:
                time.sleep(0.5)
                if handler.needs_sync and (time.time() - handler.last_change >= handler.debounce_seconds):
                    handler.needs_sync = False
                    handler.callback()
        except KeyboardInterrupt:
            observer.stop()
        observer.join()


if __name__ == "__main__":
    main()
