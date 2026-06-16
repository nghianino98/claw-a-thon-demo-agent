CREATE TABLE IF NOT EXISTS model_profiles (
  model TEXT PRIMARY KEY,
  tool_native INTEGER NOT NULL DEFAULT 0,
  tool_json INTEGER NOT NULL DEFAULT 0,
  vn_score REAL NOT NULL DEFAULT 0.0,
  long_ctx_score REAL NOT NULL DEFAULT 0.0,
  code_score REAL NOT NULL DEFAULT 0.0,
  latency_p50_ms INTEGER NOT NULL DEFAULT 0,
  ctx_window INTEGER NOT NULL DEFAULT 4096,
  probed_at TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS session_state (
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  segment_no INTEGER NOT NULL DEFAULT 1,
  segment_started_message_id INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',
  summary_upto_message_id INTEGER NOT NULL DEFAULT 0,
  active_skill TEXT,
  active_skill_expires_at TEXT,
  last_run_id INTEGER,
  pending_question TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);

CREATE TABLE IF NOT EXISTS tg_anchors (
  tg_message_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('artifact','run_progress')),
  ref_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

ALTER TABLE messages ADD COLUMN tg_message_id INTEGER;
ALTER TABLE messages ADD COLUMN reply_to_tg_message_id INTEGER;
