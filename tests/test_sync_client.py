from __future__ import annotations

import importlib.util
import sys
from pathlib import Path


def load_sync_module():
    module_path = Path(__file__).resolve().parents[1] / "scripts" / "queo_sync.py"
    spec = importlib.util.spec_from_file_location("queo_sync", module_path)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_local_manifest_applies_remote_prefix(tmp_path):
    sync = load_sync_module()
    (tmp_path / "FD").mkdir()
    (tmp_path / "FD" / "FD.md").write_text("# FD\n\nhello", encoding="utf-8")

    manifest = sync.get_local_manifest(tmp_path, "05. Knowledge")

    assert list(manifest) == ["05. Knowledge/FD/FD.md"]
    assert manifest["05. Knowledge/FD/FD.md"]["size"] > 0


def test_diff_scope_only_deletes_managed_prefix(tmp_path):
    sync = load_sync_module()
    remote = {
        "05. Knowledge/FD/OLD.md": {"sha256": "old", "size": 1},
        "03. Fact/FD/ticket.md": {"sha256": "fact", "size": 1},
    }
    local = {
        "05. Knowledge/FD/NEW.md": {"sha256": "new", "size": 2},
    }

    deleted, added_modified, target = sync.diff_manifests(remote, local, "05. Knowledge")

    assert deleted == ["05. Knowledge/FD/OLD.md"]
    assert added_modified == ["05. Knowledge/FD/NEW.md"]
    assert "03. Fact/FD/ticket.md" in target


def test_small_source_delete_is_represented_in_diff(tmp_path):
    sync = load_sync_module()
    remote = {
        "05. Knowledge/FD/one.md": {"sha256": "old", "size": 1},
    }
    local = {}

    deleted, added_modified, target = sync.diff_manifests(remote, local, "05. Knowledge/FD")

    assert deleted == ["05. Knowledge/FD/one.md"]
    assert added_modified == []
    assert target == {}


def test_config_loads_multi_source_env_values(tmp_path, monkeypatch):
    sync = load_sync_module()
    config_path = tmp_path / "sync.yaml"
    config_path.write_text(
        """
server:
  url: ${KB_SYNC_URL}
  api_key_env: KB_SYNC_KEY
sources:
  wealth_knowledge:
    path: ${KB_DIR}
    prefix: 05. Knowledge
    watch: true
    interval_seconds: 900
    quiet_seconds: ${QUIET_SECONDS}
""",
        encoding="utf-8",
    )
    monkeypatch.setenv("KB_SYNC_URL", "https://agent.example")
    monkeypatch.setenv("KB_SYNC_KEY", "secret")
    monkeypatch.setenv("KB_DIR", str(tmp_path / "05. Knowledge"))
    monkeypatch.setenv("QUIET_SECONDS", "300")

    config = sync.load_config(config_path)

    assert config.url == "https://agent.example"
    assert config.key == "secret"
    assert len(config.sources) == 1
    source = config.sources[0]
    assert source.source_id == "wealth_knowledge"
    assert source.prefix == "05. Knowledge"
    assert source.watch is True
    assert source.interval_seconds == 900.0
    assert source.quiet_seconds == 300.0
