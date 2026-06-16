from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


def parse_int_set(value: str | set[int] | None) -> set[int]:
    if value is None:
        return set()
    if isinstance(value, set):
        return value
    out: set[int] = set()
    for part in re.split(r"[,;]", str(value)):
        part = part.strip()
        if part.isdigit():
            out.add(int(part))
    return out


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = Field("development", alias="APP_ENV")
    agent_name: str = Field("Quéo", alias="AGENT_NAME")
    state_dir: Path = Field(Path("/data"), alias="STATE_DIR")
    agent_api_key: str = Field("", alias="AGENT_API_KEY")
    agent_admin_token: str = Field("", alias="AGENT_ADMIN_TOKEN")

    llm_base_url: str = Field("", alias="LLM_BASE_URL")
    llm_api_key: str = Field("", alias="LLM_API_KEY")
    llm_model: str = Field("", alias="LLM_MODEL")
    llm_model_lite: str = Field("", alias="LLM_MODEL_LITE")
    llm_timeout_seconds: int = Field(60, alias="LLM_TIMEOUT_SECONDS")
    toolcall_mode: str = Field("native", alias="TOOLCALL_MODE")

    agent_max_steps: int = Field(12, alias="AGENT_MAX_STEPS")
    agent_deep_max_steps: int = Field(24, alias="AGENT_DEEP_MAX_STEPS")
    agent_deep_timeout_seconds: int = Field(420, alias="AGENT_DEEP_TIMEOUT_SECONDS")
    agent_max_parallel_tools: int = Field(4, alias="AGENT_MAX_PARALLEL_TOOLS")
    agent_total_timeout_seconds: int = Field(120, alias="AGENT_TOTAL_TIMEOUT_SECONDS")
    agent_max_concurrent: int = Field(4, alias="AGENT_MAX_CONCURRENT")
    context_budget_chars: int = Field(48000, alias="CONTEXT_BUDGET_CHARS")
    context_budget_chars_max: int = Field(400000, alias="CONTEXT_BUDGET_CHARS_MAX")
    tool_result_max_chars: int = Field(8000, alias="TOOL_RESULT_MAX_CHARS")
    kb_read_max_chars: int = Field(12000, alias="KB_READ_MAX_CHARS")
    max_history_messages: int = Field(18, alias="MAX_HISTORY_MESSAGES")

    mcp_enabled: bool = Field(True, alias="MCP_ENABLED")
    mcp_secret_key: str = Field("", alias="MCP_SECRET_KEY")
    mcp_call_timeout_seconds: int = Field(60, alias="MCP_CALL_TIMEOUT_SECONDS")

    telegram_mode: str = Field("webhook", alias="TELEGRAM_MODE")
    telegram_bot_token: str = Field("", alias="TELEGRAM_BOT_TOKEN")
    telegram_webhook_secret: str = Field("", alias="TELEGRAM_WEBHOOK_SECRET")
    telegram_owner_user_ids: set[int] = Field(default_factory=set, alias="TELEGRAM_OWNER_USER_IDS")
    telegram_allowed_user_ids: set[int] = Field(default_factory=set, alias="TELEGRAM_ALLOWED_USER_IDS")

    rate_limit_per_minute: int = Field(6, alias="RATE_LIMIT_PER_MINUTE")
    rate_limit_per_day: int = Field(200, alias="RATE_LIMIT_PER_DAY")

    workflow_max_concurrent: int = Field(2, alias="WORKFLOW_MAX_CONCURRENT")
    workflow_max_steps: int = Field(15, alias="WORKFLOW_MAX_STEPS")
    workflow_total_timeout_seconds: int = Field(1800, alias="WORKFLOW_TOTAL_TIMEOUT_SECONDS")
    progress_first_seconds: int = Field(8, alias="PROGRESS_FIRST_SECONDS")
    progress_update_seconds: int = Field(25, alias="PROGRESS_UPDATE_SECONDS")

    kb_upload_max_mb: int = Field(2000, alias="KB_UPLOAD_MAX_MB")
    kb_file_max_mb: int = Field(20, alias="KB_FILE_MAX_MB")
    kb_keep_versions: int = Field(3, alias="KB_KEEP_VERSIONS")
    kb_delta_max_mb: int = Field(100, alias="KB_DELTA_MAX_MB")
    kb_source_dir: str = Field("", alias="KB_SOURCE_DIR")
    kb_sync_activate: str = Field("auto", alias="KB_SYNC_ACTIVATE")
    sync_api_key: str = Field("", alias="SYNC_API_KEY")
    kb_seed_zip: Path = Field(Path("seed/kb-seed.zip"), alias="KB_SEED_ZIP")

    artifact_retention_days: int = Field(14, alias="ARTIFACT_RETENTION_DAYS")

    s3_endpoint: str = Field("", alias="S3_ENDPOINT")
    s3_bucket: str = Field("", alias="S3_BUCKET")
    s3_access_key: str = Field("", alias="S3_ACCESS_KEY")
    s3_secret_key: str = Field("", alias="S3_SECRET_KEY")
    s3_region: str = Field("", alias="S3_REGION")
    backup_interval_hours: int = Field(24, alias="BACKUP_INTERVAL_HOURS")
    backup_keep: int = Field(7, alias="BACKUP_KEEP")
    backup_include_artifacts: bool = Field(False, alias="BACKUP_INCLUDE_ARTIFACTS")

    guardrail_config: Path = Field(Path("config/guardrail.yaml"), alias="GUARDRAIL_CONFIG")

    log_level: str = Field("INFO", alias="LOG_LEVEL")

    @field_validator("telegram_owner_user_ids", "telegram_allowed_user_ids", mode="before")
    @classmethod
    def _parse_int_sets(cls, value: object) -> set[int]:
        return parse_int_set(value if value is None or isinstance(value, (str, set)) else str(value))

    @field_validator("llm_base_url", mode="after")
    @classmethod
    def _strip_url(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("toolcall_mode", mode="after")
    @classmethod
    def _validate_toolcall_mode(cls, value: str) -> str:
        if value not in {"native", "json"}:
            raise ValueError("TOOLCALL_MODE must be native or json")
        return value

    @field_validator("telegram_mode", mode="after")
    @classmethod
    def _validate_telegram_mode(cls, value: str) -> str:
        if value not in {"webhook", "polling"}:
            raise ValueError("TELEGRAM_MODE must be webhook or polling")
        return value

    @model_validator(mode="after")
    def _validate_production(self) -> "Settings":
        if self.app_env != "production":
            return self
        missing: list[str] = []
        for attr, env_name in [
            ("agent_api_key", "AGENT_API_KEY"),
            ("agent_admin_token", "AGENT_ADMIN_TOKEN"),
            ("llm_base_url", "LLM_BASE_URL"),
            ("llm_api_key", "LLM_API_KEY"),
            ("llm_model", "LLM_MODEL"),
            ("telegram_bot_token", "TELEGRAM_BOT_TOKEN"),
            ("telegram_webhook_secret", "TELEGRAM_WEBHOOK_SECRET"),
        ]:
            if not getattr(self, attr):
                missing.append(env_name)
        if not self.telegram_owner_user_ids:
            missing.append("TELEGRAM_OWNER_USER_IDS")
        if self.agent_admin_token and len(self.agent_admin_token) < 32:
            missing.append("AGENT_ADMIN_TOKEN>=32chars")
        if self.telegram_webhook_secret and len(self.telegram_webhook_secret) < 32:
            missing.append("TELEGRAM_WEBHOOK_SECRET>=32chars")
        if self.mcp_enabled and len(self.mcp_secret_key) < 32:
            missing.append("MCP_SECRET_KEY>=32chars")
        if missing:
            raise ValueError("Missing/weak production config: " + ", ".join(missing))
        return self

    @property
    def has_llm(self) -> bool:
        return bool(self.llm_base_url and self.llm_model)

    @property
    def lite_model(self) -> str:
        return self.llm_model_lite or self.llm_model

    @property
    def db_path(self) -> Path:
        return self.state_dir / "queo.sqlite3"

    @property
    def kb_dir(self) -> Path:
        return self.state_dir / "kb"

    @property
    def artifacts_dir(self) -> Path:
        return self.state_dir / "artifacts"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
