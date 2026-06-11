from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

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

        asyncio.run(run())


if __name__ == "__main__":
    unittest.main()
