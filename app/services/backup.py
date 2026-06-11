from __future__ import annotations

import os
import tarfile
from pathlib import Path
from datetime import datetime, UTC
from typing import Any

import boto3
from botocore.client import Config
import zstandard as zstd

from app.db import Database
from app.settings import Settings
from app.utils import log_event


class BackupService:
    def __init__(self, db: Database, settings: Settings):
        self.db = db
        self.settings = settings
        self.enabled = bool(
            settings.s3_endpoint
            and settings.s3_bucket
            and settings.s3_access_key
            and settings.s3_secret_key
        )
        if self.enabled:
            self.s3 = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                region_name=settings.s3_region or None,
                config=Config(signature_version="s3v4")
            )
        else:
            self.s3 = None

    def backup(self) -> str | None:
        if not self.enabled:
            log_event("warning", "backup_disabled", reason="S3 not configured")
            return None

        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        backup_dir = self.settings.state_dir / "backups"
        backup_dir.mkdir(parents=True, exist_ok=True)
        backup_path = backup_dir / f"queo-{timestamp}.tar.zst"

        try:
            tmp_db_path = backup_dir / "tmp_db.sqlite3"
            if tmp_db_path.exists():
                tmp_db_path.unlink()

            with self.db.connect() as conn:
                conn.execute(f"VACUUM INTO '{tmp_db_path}'")

            cctx = zstd.ZstdCompressor(level=3)
            with open(backup_path, "wb") as f:
                with cctx.stream_writer(f) as compressor:
                    with tarfile.open(fileobj=compressor, mode="w|") as tar:
                        # Add vacuumed database as queo.sqlite3
                        tar.add(tmp_db_path, arcname="queo.sqlite3")

                        # Add active KB version directory if exists
                        active_version = None
                        try:
                            with self.db.connect() as conn:
                                row = conn.execute(
                                    "SELECT id FROM kb_versions WHERE status='active' ORDER BY id DESC LIMIT 1"
                                ).fetchone()
                                if row:
                                    active_version = int(row["id"])
                        except Exception as db_err:
                            log_event("warning", "backup_db_check_failed", error=str(db_err))

                        if active_version:
                            version_path = self.settings.kb_dir / "versions" / str(active_version)
                            if version_path.exists():
                                for p in version_path.rglob("*"):
                                    if p.is_file():
                                        rel_path = p.relative_to(self.settings.state_dir)
                                        tar.add(p, arcname=str(rel_path))

                        # Add artifacts directory if configured
                        if self.settings.backup_include_artifacts:
                            artifacts_dir = self.settings.artifacts_dir
                            if artifacts_dir.exists():
                                for p in artifacts_dir.rglob("*"):
                                    if p.is_file():
                                        rel_path = p.relative_to(self.settings.state_dir)
                                        tar.add(p, arcname=str(rel_path))

            if tmp_db_path.exists():
                tmp_db_path.unlink()

            s3_key = f"queo-backups/{backup_path.name}"
            self.s3.upload_file(str(backup_path), self.settings.s3_bucket, s3_key)
            log_event("info", "backup_uploaded", path=str(backup_path), s3_key=s3_key)

            self._cleanup_old_backups()
            return s3_key
        except Exception as e:
            log_event("error", "backup_failed", error=str(e))
            if backup_path.exists():
                backup_path.unlink()
            raise e

    def restore(self, s3_key: str | None = None) -> bool:
        if not self.enabled:
            log_event("warning", "restore_disabled", reason="S3 not configured")
            return False

        try:
            if not s3_key:
                response = self.s3.list_objects_v2(Bucket=self.settings.s3_bucket, Prefix="queo-backups/queo-")
                contents = response.get("Contents", [])
                if not contents:
                    log_event("info", "restore_no_backups_found")
                    return False
                contents.sort(key=lambda x: x["Key"], reverse=True)
                s3_key = contents[0]["Key"]

            backup_dir = self.settings.state_dir / "backups"
            backup_dir.mkdir(parents=True, exist_ok=True)
            local_backup_path = backup_dir / Path(s3_key).name

            log_event("info", "restore_downloading", s3_key=s3_key, local_path=str(local_backup_path))
            self.s3.download_file(self.settings.s3_bucket, s3_key, str(local_backup_path))

            temp_tar_path = local_backup_path.with_suffix(".tar")
            dctx = zstd.ZstdDecompressor()
            with open(local_backup_path, "rb") as fh_in, open(temp_tar_path, "wb") as fh_out:
                dctx.copy_stream(fh_in, fh_out)

            try:
                with tarfile.open(temp_tar_path, "r") as tar:
                    for member in tar:
                        target_path = (self.settings.state_dir / member.name).resolve()
                        if not target_path.is_relative_to(self.settings.state_dir.resolve()):
                            raise ValueError(f"Path traversal detected: {member.name}")
                    tar.extractall(path=self.settings.state_dir)
            finally:
                if temp_tar_path.exists():
                    temp_tar_path.unlink()

            if local_backup_path.exists():
                local_backup_path.unlink()

            # Recreate symlink atomic
            try:
                with self.db.connect() as conn:
                    row = conn.execute(
                        "SELECT id FROM kb_versions WHERE status='active' ORDER BY id DESC LIMIT 1"
                    ).fetchone()
                if row:
                    active_id = int(row["id"])
                    version_path = self.settings.kb_dir / "versions" / str(active_id)
                    if version_path.exists():
                        current_link = self.settings.kb_dir / "current"
                        tmp = self.settings.kb_dir / f".current-{active_id}.tmp"
                        if tmp.exists() or tmp.is_symlink():
                            tmp.unlink()
                        os.symlink(f"versions/{active_id}", tmp)
                        os.replace(tmp, current_link)
                        log_event("info", "restore_recreated_symlink", version=active_id)
            except Exception as link_err:
                log_event("warning", "restore_symlink_recreate_failed", error=str(link_err))

            log_event("info", "restore_successful", s3_key=s3_key)
            return True
        except Exception as e:
            log_event("error", "restore_failed", error=str(e))
            raise e

    def list_backups(self) -> list[dict[str, Any]]:
        if not self.enabled:
            return []
        try:
            response = self.s3.list_objects_v2(Bucket=self.settings.s3_bucket, Prefix="queo-backups/queo-")
            contents = response.get("Contents", [])
            contents.sort(key=lambda x: x["Key"], reverse=True)
            return [
                {
                    "key": item["Key"],
                    "size": item["Size"],
                    "last_modified": item["LastModified"].isoformat() if hasattr(item["LastModified"], "isoformat") else str(item["LastModified"]),
                }
                for item in contents
            ]
        except Exception as e:
            log_event("warning", "backup_list_failed", error=str(e))
            return []

    def _cleanup_old_backups(self) -> None:
        try:
            backup_dir = self.settings.state_dir / "backups"
            local_files = sorted(backup_dir.glob("queo-*.tar.zst"))
            keep = self.settings.backup_keep
            if len(local_files) > keep:
                for f in local_files[:-keep]:
                    f.unlink()

            response = self.s3.list_objects_v2(Bucket=self.settings.s3_bucket, Prefix="queo-backups/queo-")
            contents = response.get("Contents", [])
            if len(contents) > keep:
                contents.sort(key=lambda x: x["Key"])
                to_delete = contents[:-keep]
                delete_objects = [{"Key": item["Key"]} for item in to_delete]
                self.s3.delete_objects(
                    Bucket=self.settings.s3_bucket,
                    Delete={"Objects": delete_objects}
                )
                log_event("info", "backup_cleanup_s3", deleted_count=len(delete_objects))
        except Exception as e:
            log_event("warning", "backup_cleanup_failed", error=str(e))
