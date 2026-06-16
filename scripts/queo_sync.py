#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
import socket
import sys
import time
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

try:
    import yaml
except ImportError:  # pragma: no cover - handled at runtime for config mode.
    yaml = None

try:
    from watchdog.events import FileSystemEventHandler
    from watchdog.observers import Observer
except ImportError:
    Observer = None
    FileSystemEventHandler = object


EXCLUDED_DIRS = {".git", ".next", ".obsidian", ".vscode", ".sixth", "venv", "node_modules", "__pycache__"}
EXCLUDED_NAMES = {".DS_Store", ".greennode.json"}
DEFAULT_WAIT_SECONDS = 120.0


@dataclass(frozen=True)
class SyncSource:
    source_id: str
    path: Path
    prefix: str = ""
    enabled: bool = True
    watch: bool = False
    interval_seconds: float | None = None
    quiet_seconds: float = 300.0


@dataclass(frozen=True)
class SyncRuntimeConfig:
    url: str
    key: str
    wait_seconds: float
    sources: list[SyncSource]


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(64 * 1024):
            h.update(chunk)
    return h.hexdigest()


def normalize_prefix(prefix: str | None) -> str:
    if not prefix:
        return ""
    return str(prefix).strip().strip("/")


def prefixed_path(rel_path: str, prefix: str | None) -> str:
    clean_prefix = normalize_prefix(prefix)
    rel = rel_path.strip("/")
    return f"{clean_prefix}/{rel}" if clean_prefix else rel


def strip_prefix(remote_path: str, prefix: str | None) -> str:
    clean_prefix = normalize_prefix(prefix)
    if not clean_prefix:
        return remote_path
    marker = clean_prefix + "/"
    if remote_path.startswith(marker):
        return remote_path[len(marker) :]
    raise ValueError(f"path {remote_path!r} is outside managed prefix {clean_prefix!r}")


def is_managed_remote_path(remote_path: str, prefix: str | None) -> bool:
    clean_prefix = normalize_prefix(prefix)
    if not clean_prefix:
        return True
    return remote_path.startswith(clean_prefix + "/")


def manifest_sha(files: dict[str, dict[str, Any]]) -> str:
    comparable = {
        path: {"sha256": meta["sha256"], "size": int(meta["size"])}
        for path, meta in sorted(files.items())
    }
    manifest_json = json.dumps(comparable, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(manifest_json.encode("utf-8")).hexdigest()


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


def get_local_manifest(root: Path, prefix: str = "") -> dict[str, dict[str, Any]]:
    manifest: dict[str, dict[str, Any]] = {}
    root = root.expanduser().resolve()
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
                manifest[prefixed_path(rel, prefix)] = {"sha256": sha, "size": size}
            except Exception as exc:
                print(f"WARNING: skipped unreadable file {path}: {exc}", flush=True)
    return manifest


def diff_manifests(
    remote_files: dict[str, dict[str, Any]],
    local_files: dict[str, dict[str, Any]],
    prefix: str = "",
) -> tuple[list[str], list[str], dict[str, dict[str, Any]]]:
    managed_remote_files = {
        path: meta
        for path, meta in remote_files.items()
        if is_managed_remote_path(path, prefix)
    }

    deleted = sorted(path for path in managed_remote_files if path not in local_files)
    added_modified = sorted(
        path
        for path, meta in local_files.items()
        if not remote_files.get(path)
        or remote_files[path].get("sha256") != meta.get("sha256")
        or int(remote_files[path].get("size", -1)) != int(meta.get("size", -2))
    )

    target_manifest = {
        path: meta
        for path, meta in remote_files.items()
        if path not in deleted
    }
    for path in added_modified:
        target_manifest[path] = local_files[path]

    return deleted, added_modified, target_manifest


def local_file_for_remote_path(root: Path, remote_path: str, prefix: str = "") -> Path:
    return root / strip_prefix(remote_path, prefix)


def fetch_remote_manifest(client: httpx.Client, base_url: str, headers: dict[str, str]) -> dict[str, Any]:
    manifest_url = f"{base_url.rstrip('/')}/admin/api/kb/manifest"
    resp = client.get(manifest_url, headers=headers)
    if resp.status_code == 401:
        raise RuntimeError("Authentication failed (401 Unauthorized). Check X-Sync-Api-Key.")
    resp.raise_for_status()
    return resp.json()


def wait_for_active_manifest(
    client: httpx.Client,
    base_url: str,
    headers: dict[str, str],
    expected_sha: str,
    wait_seconds: float,
    source_id: str,
) -> bool:
    if wait_seconds <= 0:
        return True

    deadline = time.time() + wait_seconds
    last_version = None
    while time.time() < deadline:
        try:
            remote_data = fetch_remote_manifest(client, base_url, headers)
            last_version = remote_data.get("kb_version")
            remote_files = remote_data.get("files") or {}
            if manifest_sha(remote_files) == expected_sha:
                print(f"[{source_id}] Active KB manifest verified at version v{last_version}.")
                return True
        except Exception as exc:
            print(f"[{source_id}] Waiting for manifest verification: {exc}")
        time.sleep(2)

    try:
        status_url = f"{base_url.rstrip('/')}/admin/api/kb/sync-status"
        status = client.get(status_url, headers=headers, timeout=10)
        detail = status.text[:1000]
    except Exception as exc:
        detail = f"sync-status unavailable: {exc}"
    print(
        f"[{source_id}] Delta was accepted but active manifest did not match within "
        f"{wait_seconds:.0f}s. Last version={last_version}. {detail}"
    )
    return False


def perform_sync(
    url: str,
    key: str,
    source: SyncSource,
    dry_run: bool = False,
    wait_seconds: float = DEFAULT_WAIT_SECONDS,
) -> bool:
    sync_dir = source.path.expanduser()
    source_id = source.source_id
    print(f"[{source_id}] Starting sync for: {sync_dir.resolve()}")
    if source.prefix:
        print(f"[{source_id}] Remote prefix: {source.prefix}")
    if not sync_dir.exists():
        print(f"[{source_id}] ERROR: Directory {sync_dir} does not exist.")
        return False

    headers = {"X-Sync-Api-Key": key}
    try:
        with httpx.Client(timeout=30) as client:
            remote_data = fetch_remote_manifest(client, url, headers)
            base_version = remote_data.get("kb_version")
            if base_version is None:
                print(f"[{source_id}] ERROR: Remote KB has no active version. Run a full upload first.")
                return False

            remote_files = remote_data.get("files") or {}
            local_files = get_local_manifest(sync_dir, source.prefix)
            deleted, added_modified, target_manifest = diff_manifests(remote_files, local_files, source.prefix)

            if not deleted and not added_modified:
                print(f"[{source_id}] Directory is fully synchronized. No changes detected.")
                return True

            managed_count = len([path for path in remote_files if is_managed_remote_path(path, source.prefix)])
            print(f"[{source_id}] Changes detected: Added/Modified={len(added_modified)}, Deleted={len(deleted)}")
            if deleted and managed_count > 10 and len(deleted) > 0.3 * managed_count:
                print(
                    f"[{source_id}] Protection trigger: deleting {len(deleted)}/{managed_count} managed files "
                    "exceeds 30%. Use a reviewed full upload."
                )
                return False

            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, "w", zipfile.ZIP_DEFLATED) as zf:
                for remote_path in added_modified:
                    full_path = local_file_for_remote_path(sync_dir, remote_path, source.prefix)
                    zf.write(full_path, remote_path)
            zip_bytes = zip_buffer.getvalue()

            client_manifest_sha = manifest_sha(target_manifest)
            meta_payload = {
                "base_version": base_version,
                "client_host": socket.gethostname(),
                "source_id": source_id,
                "prefix": source.prefix,
                "deleted": deleted,
                "added_modified": added_modified,
                "client_manifest_sha": client_manifest_sha,
            }

            if dry_run:
                print(f"[{source_id}] Dry run enabled. No delta upload will be sent.")
                preview = {
                    "base_version": base_version,
                    "prefix": source.prefix,
                    "added_modified": added_modified[:100],
                    "deleted": deleted[:100],
                    "added_modified_count": len(added_modified),
                    "deleted_count": len(deleted),
                    "archive_bytes": len(zip_bytes),
                    "client_manifest_sha": client_manifest_sha,
                }
                print(json.dumps(preview, ensure_ascii=False, indent=2))
                return True

            delta_url = f"{url.rstrip('/')}/admin/api/kb/delta"
            files = {"archive": ("delta.zip", zip_bytes, "application/zip")}
            data = {"meta": json.dumps(meta_payload)}
            resp = client.post(delta_url, headers=headers, data=data, files=files, timeout=60)
            if resp.status_code != 200:
                print(f"[{source_id}] Delta sync failed ({resp.status_code}): {resp.text}")
                return False

            print(f"[{source_id}] Delta sync accepted: {resp.json()}")
            return wait_for_active_manifest(client, url, headers, client_manifest_sha, wait_seconds, source_id)
    except Exception as exc:
        print(f"[{source_id}] ERROR: sync failed: {exc}")
        return False


class SyncHandler(FileSystemEventHandler):
    def __init__(self, source: SyncSource, mark_dirty):
        self.source = source
        self.mark_dirty = mark_dirty

    def on_any_event(self, event):
        if event.is_directory:
            return
        path = Path(event.src_path)
        if is_excluded(path, self.source.path.expanduser().resolve()):
            return
        self.mark_dirty(self.source.source_id)


class SyncManager:
    def __init__(self, config: SyncRuntimeConfig, dry_run: bool = False):
        self.config = config
        self.dry_run = dry_run
        self.sources = {source.source_id: source for source in config.sources if source.enabled}
        now = time.time()
        self.state = {
            source.source_id: {
                "needs_sync": False,
                "last_change": 0.0,
                "next_interval": now + source.interval_seconds if source.interval_seconds else None,
            }
            for source in self.sources.values()
        }

    def mark_dirty(self, source_id: str) -> None:
        state = self.state[source_id]
        state["needs_sync"] = True
        state["last_change"] = time.time()
        print(f"[{source_id}] Change detected; waiting for quiet period.")

    def sync_source(self, source: SyncSource) -> bool:
        return perform_sync(
            self.config.url,
            self.config.key,
            source,
            dry_run=self.dry_run,
            wait_seconds=self.config.wait_seconds,
        )

    def run_once(self) -> bool:
        ok = True
        for source in self.sources.values():
            ok = self.sync_source(source) and ok
        return ok

    def serve(self) -> int:
        watch_sources = [source for source in self.sources.values() if source.watch]
        interval_sources = [source for source in self.sources.values() if source.interval_seconds]
        if not watch_sources and not interval_sources:
            print("No enabled sources have watch=true or interval_seconds configured.")
            return 2
        if watch_sources and Observer is None:
            print("ERROR: watch mode requires the optional 'watchdog' package. Install requirements.txt.")
            return 2

        observer = None
        if watch_sources:
            observer = Observer()
            for source in watch_sources:
                print(f"[{source.source_id}] Watching directory: {source.path.expanduser().resolve()}")
                observer.schedule(SyncHandler(source, self.mark_dirty), str(source.path.expanduser()), recursive=True)
            observer.start()

        for source in {source.source_id: source for source in watch_sources + interval_sources}.values():
            self.sync_source(source)

        try:
            while True:
                now = time.time()
                for source in self.sources.values():
                    state = self.state[source.source_id]
                    if state["needs_sync"] and now - state["last_change"] >= source.quiet_seconds:
                        state["needs_sync"] = False
                        self.sync_source(source)
                    next_interval = state["next_interval"]
                    if next_interval and now >= next_interval:
                        self.sync_source(source)
                        state["next_interval"] = now + float(source.interval_seconds or 0)
                time.sleep(1)
        except KeyboardInterrupt:
            pass
        finally:
            if observer is not None:
                observer.stop()
                observer.join()
        return 0


def expand_value(value: Any) -> Any:
    if isinstance(value, str):
        return os.path.expandvars(os.path.expanduser(value))
    return value


def as_bool(value: Any, default: bool = False) -> bool:
    value = expand_value(value)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in {"1", "true", "yes", "y", "on"}


def as_float(value: Any, default: float | None = None) -> float | None:
    value = expand_value(value)
    if value in {None, ""}:
        return default
    return float(value)


def load_config(path: Path, selected_ids: set[str] | None = None) -> SyncRuntimeConfig:
    if yaml is None:
        raise RuntimeError("Config mode requires PyYAML. Install requirements.txt first.")
    raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    server = raw.get("server") or {}
    url = expand_value(server.get("url") or raw.get("url") or os.getenv("KB_SYNC_URL", ""))
    key_env = server.get("api_key_env") or raw.get("api_key_env") or "KB_SYNC_KEY"
    key = expand_value(server.get("api_key") or raw.get("api_key") or os.getenv(str(key_env), ""))
    wait_seconds = as_float(server.get("wait_seconds") or raw.get("wait_seconds"), DEFAULT_WAIT_SECONDS)

    if not url:
        raise ValueError("Missing sync server url in config or KB_SYNC_URL.")
    if not key:
        raise ValueError(f"Missing sync API key. Set {key_env} or configure server.api_key.")

    sources_raw = raw.get("sources") or {}
    if isinstance(sources_raw, dict):
        source_items = [{"id": source_id, **(source_cfg or {})} for source_id, source_cfg in sources_raw.items()]
    elif isinstance(sources_raw, list):
        source_items = sources_raw
    else:
        raise ValueError("sources must be a mapping or a list.")

    sources: list[SyncSource] = []
    for item in source_items:
        source_id = str(item.get("id") or item.get("name") or "").strip()
        if not source_id:
            raise ValueError("Every sync source must have an id.")
        if selected_ids and source_id not in selected_ids:
            continue

        triggers = item.get("triggers") or {}
        modes = item.get("mode") or item.get("modes") or []
        if isinstance(modes, str):
            modes = [modes]
        modes = {str(mode).strip().lower() for mode in modes}

        watch = as_bool(item.get("watch", triggers.get("watch")), "watch" in modes)
        interval_seconds = as_float(item.get("interval_seconds", triggers.get("interval_seconds")))
        if interval_seconds is None and "interval" in modes:
            interval_seconds = 900.0
        if "manual" in modes and not watch and interval_seconds is None:
            interval_seconds = None

        sources.append(
            SyncSource(
                source_id=source_id,
                path=Path(str(expand_value(item.get("path", "")))),
                prefix=normalize_prefix(str(expand_value(item.get("prefix", "")))),
                enabled=as_bool(item.get("enabled"), True),
                watch=watch,
                interval_seconds=interval_seconds,
                quiet_seconds=float(as_float(item.get("quiet_seconds", triggers.get("quiet_seconds")), 300.0) or 300.0),
            )
        )

    if selected_ids:
        found = {source.source_id for source in sources}
        missing = selected_ids - found
        if missing:
            raise ValueError(f"Unknown sync source(s): {', '.join(sorted(missing))}")
    if not sources:
        raise ValueError("No sync sources configured.")

    return SyncRuntimeConfig(url=str(url), key=str(key), wait_seconds=float(wait_seconds or 0), sources=sources)


def build_legacy_config(args: argparse.Namespace) -> SyncRuntimeConfig:
    if not args.key:
        raise ValueError("X-Sync-Api-Key must be provided via --key or KB_SYNC_KEY.")
    source = SyncSource(
        source_id=args.source_id,
        path=Path(args.dir),
        prefix=normalize_prefix(args.prefix),
        watch=bool(args.watch),
        interval_seconds=as_float(args.interval_seconds),
        quiet_seconds=float(args.debounce_seconds),
    )
    return SyncRuntimeConfig(url=args.url, key=args.key, wait_seconds=float(args.wait_seconds), sources=[source])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Quéo Solution KB Sync Client")
    parser.add_argument("--config", help="YAML config file for multiple sync sources")
    parser.add_argument("--source", action="append", dest="sources", help="Source id to run from --config; repeatable")
    parser.add_argument("--list-sources", action="store_true", help="List configured sources and exit")
    parser.add_argument("--serve", action="store_true", help="Run configured watch/interval sources continuously")

    parser.add_argument("--url", default=os.getenv("KB_SYNC_URL", "http://localhost:8000"), help="Agent URL")
    parser.add_argument("--key", default=os.getenv("KB_SYNC_KEY", ""), help="X-Sync-Api-Key token")
    parser.add_argument("--dir", default=".", help="Directory to sync in legacy single-source mode")
    parser.add_argument("--prefix", default="", help="Remote path prefix for this local directory")
    parser.add_argument("--source-id", default="default", help="Source id for logs in legacy mode")
    parser.add_argument("--interval-seconds", default="", help="Periodic sync interval for legacy serve mode")
    parser.add_argument("--debounce-seconds", type=float, default=float(os.getenv("KB_SYNC_QUIET_SECONDS", "300")))
    parser.add_argument("--wait-seconds", type=float, default=DEFAULT_WAIT_SECONDS)

    parser.add_argument("--once", action="store_true", help="Sync once and exit")
    parser.add_argument("--watch", action="store_true", help="Watch continuously using watchdog")
    parser.add_argument("--dry-run", action="store_true", help="Compare and print the delta without uploading it")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    selected = set(args.sources or [])

    try:
        if args.config:
            config = load_config(Path(args.config), selected or None)
        else:
            config = build_legacy_config(args)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    if args.list_sources:
        for source in config.sources:
            print(
                json.dumps(
                    {
                        "id": source.source_id,
                        "path": str(source.path),
                        "prefix": source.prefix,
                        "enabled": source.enabled,
                        "watch": source.watch,
                        "interval_seconds": source.interval_seconds,
                        "quiet_seconds": source.quiet_seconds,
                    },
                    ensure_ascii=False,
                )
            )
        return 0

    manager = SyncManager(config, dry_run=args.dry_run)
    if args.serve or args.watch:
        return manager.serve()

    success = manager.run_once()
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
