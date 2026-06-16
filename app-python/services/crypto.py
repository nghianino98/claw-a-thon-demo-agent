from __future__ import annotations

import base64
import hashlib

from app.settings import Settings


class SecretCipher:
    def __init__(self, settings: Settings):
        key_material = settings.mcp_secret_key or settings.agent_admin_token or settings.agent_api_key
        if not key_material:
            key_material = "development-only-mcp-secret-key"
        digest = hashlib.sha256(key_material.encode("utf-8")).digest()
        self._fernet_key = base64.urlsafe_b64encode(digest)

    def encrypt(self, value: str) -> bytes:
        from cryptography.fernet import Fernet

        return Fernet(self._fernet_key).encrypt(value.encode("utf-8"))

    def decrypt(self, value: bytes) -> str:
        from cryptography.fernet import Fernet

        return Fernet(self._fernet_key).decrypt(value).decode("utf-8")
