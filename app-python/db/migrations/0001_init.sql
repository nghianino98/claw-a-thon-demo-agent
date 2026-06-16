PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS instructions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(name, version)
);

CREATE TABLE IF NOT EXISTS skills (
  skill_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  triggers TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source IN ('kb','admin')),
  kb_path TEXT,
  content_override TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS workflows (
  workflow_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL CHECK(source IN ('kb','admin')),
  kb_path TEXT,
  content_override TEXT,
  schedule TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK(trigger IN ('telegram','admin','schedule','api')),
  triggered_by TEXT,
  params TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  log TEXT NOT NULL DEFAULT '[]',
  artifacts TEXT NOT NULL DEFAULT '[]',
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_status ON workflow_runs(status, created_at);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(user_id, session_id, id);

CREATE TABLE IF NOT EXISTS facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_id, key, value)
);

CREATE TABLE IF NOT EXISTS telegram_access (
  user_id INTEGER PRIMARY KEY,
  chat_id INTEGER,
  display_name TEXT,
  username TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','allowed','rejected','revoked')),
  approved_by TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS kb_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL CHECK(status IN ('processing','ready','active','failed','archived')),
  uploaded_by TEXT,
  original_filename TEXT,
  file_count INTEGER,
  chunk_count INTEGER,
  total_bytes INTEGER,
  skill_count INTEGER,
  workflow_count INTEGER,
  error TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  activated_at TEXT,
  kind TEXT NOT NULL DEFAULT 'full' CHECK(kind IN ('full','delta')),
  base_version INTEGER,
  change_summary TEXT
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  path,
  title,
  product,
  area,
  content,
  tokenize="unicode61 remove_diacritics 2"
);

CREATE TABLE IF NOT EXISTS chunks_meta (
  rowid_fts INTEGER PRIMARY KEY,
  path TEXT NOT NULL,
  file_sha TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  mtime TEXT
);
CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks_meta(path, file_sha);

CREATE TABLE IF NOT EXISTS chunk_embeddings (
  rowid_fts INTEGER PRIMARY KEY,
  model TEXT,
  vector BLOB
);

CREATE TABLE IF NOT EXISTS kb_files (
  kb_version INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime TEXT NOT NULL,
  PRIMARY KEY (kb_version, path)
);

CREATE TABLE IF NOT EXISTS sync_state (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_sync_at TEXT,
  last_client_host TEXT,
  last_result TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  detail TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit ON audit_log(action, created_at);

CREATE TABLE IF NOT EXISTS llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT,
  purpose TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  run_id INTEGER,
  user_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  user_id TEXT NOT NULL,
  window_start TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY(user_id, window_start)
);

