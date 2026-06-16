CREATE TABLE IF NOT EXISTS mcp_servers (
  server_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  transport TEXT NOT NULL CHECK(transport IN ('stdio','http')),
  command TEXT,
  args TEXT NOT NULL DEFAULT '[]',
  base_url TEXT,
  env_public TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'unknown',
  last_error TEXT,
  last_checked_at TEXT,
  tool_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mcp_servers_prefix
ON mcp_servers(prefix);

CREATE TABLE IF NOT EXISTS mcp_secrets (
  server_id TEXT NOT NULL,
  secret_key TEXT NOT NULL,
  value_encrypted BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (server_id, secret_key),
  FOREIGN KEY (server_id) REFERENCES mcp_servers(server_id) ON DELETE CASCADE
);

INSERT INTO mcp_servers(
  server_id, name, prefix, transport, command, args, base_url, env_public,
  enabled, status, updated_at, updated_by
)
SELECT
  'tableau-local',
  'Tableau MCP - Atlas',
  'tableau',
  'stdio',
  'npx',
  '["-y","@tableau/mcp-server@latest"]',
  NULL,
  '{"SERVER":"https://atlas.vng.com.vn","SITE_NAME":"","PAT_NAME":"","AUTH":"pat","PRODUCT_TELEMETRY_ENABLED":"false","LOG_LEVEL":"error"}',
  0,
  'unknown',
  CURRENT_TIMESTAMP,
  'migration'
WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE server_id='tableau-local');
