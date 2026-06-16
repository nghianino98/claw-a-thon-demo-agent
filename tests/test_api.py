from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
import zipfile

import httpx

from app.main import create_app
from app.settings import Settings


class ApiTests(unittest.TestCase):
    def test_health_and_invocations(self):
        async def run():
            with tempfile.TemporaryDirectory() as td:
                settings = Settings(
                    APP_ENV="development",
                    STATE_DIR=str(Path(td) / "state"),
                    AGENT_API_KEY="test-key",
                    AGENT_ADMIN_TOKEN="admin-token",
                    TELEGRAM_OWNER_USER_IDS="100",
                    TELEGRAM_MODE="webhook",
                )
                app = create_app(settings)
                transport = httpx.ASGITransport(app=app)
                async with app.router.lifespan_context(app):
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                        resp = await client.get("/health")
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(resp.json()["status"], "ok")
                        denied = await client.post("/invocations", json={"message": "hi"})
                        self.assertEqual(denied.status_code, 401)
                        ok = await client.post("/invocations", headers={"X-Agent-Api-Key": "test-key"}, json={"message": "hi"})
                        self.assertEqual(ok.status_code, 200)
                        self.assertEqual(ok.json()["status"], "success")
                        self.assertIn("citations", ok.json())
                        self.assertNotIn("kb:", ok.json()["response"])
                        answers_denied = await client.get("/admin/api/answers")
                        self.assertEqual(answers_denied.status_code, 401)
                        admin_headers = {
                            "Authorization": "Bearer admin-token",
                            "X-Acting-User": "duy",
                            "X-Acting-Role": "viewer",
                        }
                        answers = await client.get("/admin/api/answers", headers=admin_headers)
                        self.assertEqual(answers.status_code, 200)
                        payload = answers.json()
                        self.assertEqual(payload["status"], "success")
                        self.assertEqual(len(payload["answers"]), 1)
                        self.assertEqual(payload["answers"][0]["question"], "hi")
                        self.assertIn("answer", payload["answers"][0])
                        forbidden = await client.post("/admin/api/backup", headers=admin_headers)
                        self.assertEqual(forbidden.status_code, 403)
                        backups = await client.get("/admin/api/backup", headers=admin_headers)
                        self.assertEqual(backups.status_code, 200)
                        self.assertFalse(backups.json()["enabled"])
                        self.assertEqual(backups.json()["backups"], [])

        asyncio.run(run())

    def test_model_routing_validation(self):
        async def run():
            with tempfile.TemporaryDirectory() as td:
                settings = Settings(
                    APP_ENV="development",
                    STATE_DIR=str(Path(td) / "state"),
                    AGENT_API_KEY="test-key",
                    AGENT_ADMIN_TOKEN="admin-token",
                    TELEGRAM_OWNER_USER_IDS="100",
                    TELEGRAM_MODE="webhook",
                )
                app = create_app(settings)
                transport = httpx.ASGITransport(app=app)
                async with app.router.lifespan_context(app):
                    services = app.state.services
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                        headers = {
                            "Authorization": "Bearer admin-token",
                            "X-Acting-User": "duy",
                            "X-Acting-Role": "superadmin",
                        }
                        invalid = await client.patch(
                            "/admin/api/settings",
                            headers=headers,
                            json={"values": {"model_routing": {"classes": {"agent": "unprofiled-model"}}}},
                        )
                        self.assertEqual(invalid.status_code, 409)

                        deep_without_tool_profile = await client.patch(
                            "/admin/api/settings",
                            headers=headers,
                            json={"values": {"model_routing": {"classes": {"deep": "unprofiled-model"}}}},
                        )
                        self.assertEqual(deep_without_tool_profile.status_code, 200)

                        with services.db.connect() as conn:
                            conn.execute(
                                """
                                INSERT INTO model_profiles(model, tool_native, tool_json, ctx_window)
                                VALUES ('profiled-model', 1, 0, 128000)
                                """
                            )
                            conn.commit()

                        valid = await client.patch(
                            "/admin/api/settings",
                            headers=headers,
                            json={"values": {"model_routing": {"classes": {"agent": "profiled-model"}}}},
                        )
                        self.assertEqual(valid.status_code, 200)

        asyncio.run(run())

    def test_mcp_mutations_require_superadmin(self):
        async def run():
            with tempfile.TemporaryDirectory() as td:
                settings = Settings(
                    APP_ENV="development",
                    STATE_DIR=str(Path(td) / "state"),
                    AGENT_API_KEY="test-key",
                    AGENT_ADMIN_TOKEN="admin-token",
                    TELEGRAM_OWNER_USER_IDS="100",
                    TELEGRAM_MODE="webhook",
                )
                app = create_app(settings)
                transport = httpx.ASGITransport(app=app)
                async with app.router.lifespan_context(app):
                    payload = {
                        "server_id": "local-tools",
                        "name": "Local Tools",
                        "prefix": "local",
                        "transport": "stdio",
                        "command": "npx",
                        "args": ["-y", "example-mcp"],
                        "enabled": False,
                    }
                    operator_headers = {
                        "Authorization": "Bearer admin-token",
                        "X-Acting-User": "duy",
                        "X-Acting-Role": "operator",
                    }
                    superadmin_headers = {
                        "Authorization": "Bearer admin-token",
                        "X-Acting-User": "duy",
                        "X-Acting-Role": "superadmin",
                    }
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                        denied = await client.post("/admin/api/mcp/servers", headers=operator_headers, json=payload)
                        self.assertEqual(denied.status_code, 403)

                        allowed = await client.post("/admin/api/mcp/servers", headers=superadmin_headers, json=payload)
                        self.assertEqual(allowed.status_code, 200)

                        test_denied = await client.post(
                            "/admin/api/mcp/servers/local-tools/test",
                            headers=operator_headers,
                        )
                        self.assertEqual(test_denied.status_code, 403)

        asyncio.run(run())

    def test_kb_upload_backup_trigger_respects_activate_flag(self):
        class FakeBackup:
            enabled = True

            def __init__(self):
                self.calls = 0

            def backup(self):
                self.calls += 1
                return f"backup-{self.calls}"

        def kb_zip_bytes(label: str):
            import io

            buffer = io.BytesIO()
            with zipfile.ZipFile(buffer, "w") as zf:
                zf.writestr("05. Knowledge/FD/FD.md", f"# FD\n\n{label}")
            buffer.seek(0)
            return buffer

        async def run():
            with tempfile.TemporaryDirectory() as td:
                settings = Settings(
                    APP_ENV="development",
                    STATE_DIR=str(Path(td) / "state"),
                    AGENT_API_KEY="test-key",
                    AGENT_ADMIN_TOKEN="admin-token",
                    TELEGRAM_OWNER_USER_IDS="100",
                    TELEGRAM_MODE="webhook",
                )
                app = create_app(settings)
                transport = httpx.ASGITransport(app=app)
                async with app.router.lifespan_context(app):
                    services = app.state.services
                    fake_backup = FakeBackup()
                    services.backup = fake_backup
                    headers = {
                        "Authorization": "Bearer admin-token",
                        "X-Acting-User": "duy",
                        "X-Acting-Role": "operator",
                    }
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                        ready = await client.post(
                            "/admin/api/kb/upload?activate=false",
                            headers=headers,
                            files={"file": ("kb-ready.zip", kb_zip_bytes("ready"), "application/zip")},
                        )
                        self.assertEqual(ready.status_code, 200)
                        self.assertEqual(fake_backup.calls, 0)

                        active = await client.post(
                            "/admin/api/kb/upload?activate=true",
                            headers=headers,
                            files={"file": ("kb-active.zip", kb_zip_bytes("active"), "application/zip")},
                        )
                        self.assertEqual(active.status_code, 200)
                        self.assertEqual(fake_backup.calls, 1)

        asyncio.run(run())

    def test_admin_skills_and_workflows(self):
        async def run():
            with tempfile.TemporaryDirectory() as td:
                settings = Settings(
                    APP_ENV="development",
                    STATE_DIR=str(Path(td) / "state"),
                    AGENT_API_KEY="test-key",
                    AGENT_ADMIN_TOKEN="admin-token",
                    TELEGRAM_OWNER_USER_IDS="100",
                    TELEGRAM_MODE="webhook",
                )
                app = create_app(settings)
                transport = httpx.ASGITransport(app=app)
                async with app.router.lifespan_context(app):
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                        admin_headers = {
                            "Authorization": "Bearer admin-token",
                            "X-Acting-User": "duy",
                            "X-Acting-Role": "operator",
                        }
                        
                        # List initially empty
                        resp = await client.get("/admin/api/skills", headers=admin_headers)
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(len(resp.json()["skills"]), 0)
                        
                        # Create skill
                        resp = await client.post("/admin/api/skills", headers=admin_headers, json={
                            "skill_id": "test-skill",
                            "name": "Test Skill",
                            "description": "This is a test skill description",
                            "triggers": "test trigger",
                            "content_override": "override content",
                            "enabled": True
                        })
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(resp.json()["skill_id"], "test-skill")
                        
                        # Get skill (list all)
                        resp = await client.get("/admin/api/skills", headers=admin_headers)
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(len(resp.json()["skills"]), 1)
                        self.assertEqual(resp.json()["skills"][0]["skill_id"], "test-skill")
                        
                        # Patch skill
                        resp = await client.patch("/admin/api/skills/test-skill", headers=admin_headers, json={
                            "name": "Updated Test Skill",
                            "enabled": False
                        })
                        self.assertEqual(resp.status_code, 200)
                        
                        # Get skill (list all should still return it even if disabled)
                        resp = await client.get("/admin/api/skills", headers=admin_headers)
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(len(resp.json()["skills"]), 1)
                        self.assertEqual(resp.json()["skills"][0]["name"], "Updated Test Skill")
                        self.assertEqual(resp.json()["skills"][0]["enabled"], False)

                        # Workflows creation & updating
                        resp = await client.get("/admin/api/workflows", headers=admin_headers)
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(len(resp.json()["workflows"]), 0)
                        
                        resp = await client.post("/admin/api/workflows", headers=admin_headers, json={
                            "workflow_id": "test-workflow",
                            "name": "Test Workflow",
                            "description": "Test workflow description",
                            "content_override": "workflow steps override",
                            "schedule": "*/5 * * * *",
                            "enabled": True
                        })
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(resp.json()["workflow_id"], "test-workflow")
                        
                        resp = await client.get("/admin/api/workflows", headers=admin_headers)
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(len(resp.json()["workflows"]), 1)
                        self.assertEqual(resp.json()["workflows"][0]["workflow_id"], "test-workflow")

                        conflict = await client.patch("/admin/api/workflows/test-workflow", headers=admin_headers, json={
                            "command_alias": "test_skill"
                        })
                        self.assertEqual(conflict.status_code, 409)
                        
                        resp = await client.patch("/admin/api/workflows/test-workflow", headers=admin_headers, json={
                            "name": "Updated Test Workflow",
                            "schedule": None
                        })
                        self.assertEqual(resp.status_code, 200)
                        
                        resp = await client.get("/admin/api/workflows", headers=admin_headers)
                        self.assertEqual(resp.status_code, 200)
                        self.assertEqual(resp.json()["workflows"][0]["name"], "Updated Test Workflow")
                        self.assertIsNone(resp.json()["workflows"][0]["schedule"])

        asyncio.run(run())

    def test_kb_delta_deletion_threshold(self):
        async def run():
            with tempfile.TemporaryDirectory() as td:
                settings = Settings(
                    APP_ENV="development",
                    STATE_DIR=str(Path(td) / "state"),
                    AGENT_API_KEY="test-key",
                    AGENT_ADMIN_TOKEN="admin-token",
                    SYNC_API_KEY="sync-key",
                    TELEGRAM_OWNER_USER_IDS="100",
                    TELEGRAM_MODE="webhook",
                )
                app = create_app(settings)
                transport = httpx.ASGITransport(app=app)
                async with app.router.lifespan_context(app):
                    services = app.state.services
                    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                        # Setup fake active version with files
                        with services.db.connect() as conn:
                            # insert fake active version
                            conn.execute(
                                "INSERT INTO kb_versions(id, status, uploaded_by, original_filename, created_at, kind) VALUES (1, 'active', 'test', 'test.zip', '2026-06-11', 'full')"
                            )
                            # insert 10 fake files
                            for i in range(10):
                                conn.execute(
                                    "INSERT INTO kb_files(kb_version, path, sha256, size, mtime) VALUES (1, ?, 'sha', 100, '2026-06-11')",
                                    (f"file_{i}.md",)
                                )
                            conn.commit()
                        
                        # Verify we can active version 1
                        self.assertEqual(services.kb.active_version(), 1)
                        
                        # Try to send delta sync with 4 deletions (4/10 = 40% > 30%)
                        # This should be rejected with 400
                        headers = {"X-Sync-Api-Key": "sync-key"}
                        import io
                        meta_data = {
                            "base_version": 1,
                            "deleted": ["file_0.md", "file_1.md", "file_2.md", "file_3.md"],
                            "added_modified": []
                        }
                        # We need to send multipart/form-data
                        files = {
                            "archive": ("delta.zip", io.BytesIO(b"PK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"), "application/zip")
                        }
                        data = {"meta": json.dumps(meta_data)}
                        resp = await client.post("/admin/api/kb/delta", headers=headers, data=data, files=files)
                        self.assertEqual(resp.status_code, 400)
                        self.assertIn("quá nhiều file bị xóa", resp.json()["error"])
                        
                        # Try to send delta sync with 2 deletions (2/10 = 20% <= 30%)
                        # This should be accepted with 200 status (although the background task might fail/succeed, the HTTP status code is 200)
                        meta_data_ok = {
                            "base_version": 1,
                            "deleted": ["file_0.md", "file_1.md"],
                            "added_modified": []
                        }
                        data_ok = {"meta": json.dumps(meta_data_ok)}
                        files = {
                            "archive": ("delta.zip", io.BytesIO(b"PK\x05\x06\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00"), "application/zip")
                        }
                        # Mock the actual process_delta_task background task to avoid actual execution if it tries to unzip
                        resp_ok = await client.post("/admin/api/kb/delta", headers=headers, data=data_ok, files=files)
                        # The HTTP request is accepted (200 OK)
                        self.assertEqual(resp_ok.status_code, 200)

                        # Verify we can clear the KB
                        admin_operator_headers = {
                            "Authorization": "Bearer admin-token",
                            "X-Acting-User": "duy",
                            "X-Acting-Role": "operator",
                        }
                        clear_resp = await client.post("/admin/api/kb/clear", headers=admin_operator_headers)
                        self.assertEqual(clear_resp.status_code, 200)
                        self.assertEqual(clear_resp.json()["status"], "success")
                        
                        # Verify it is now empty in status API
                        status_resp = await client.get("/admin/api/status", headers=admin_operator_headers)
                        self.assertEqual(status_resp.status_code, 200)
                        self.assertIsNone(status_resp.json()["kb"]["kb_version"])
                        self.assertFalse(status_resp.json()["kb"]["available"])

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
