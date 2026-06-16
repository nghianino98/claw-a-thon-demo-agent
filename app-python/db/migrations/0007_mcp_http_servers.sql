-- Add HTTP MCP servers (ngrok endpoints)
INSERT INTO mcp_servers(
  server_id, name, prefix, transport, command, args, base_url, env_public,
  enabled, status, updated_at, updated_by
)
SELECT
  'tableau-http',
  'Tableau MCP - HTTP',
  'tb',
  'http',
  NULL,
  '[]',
  'https://yahoo-trash-overeater.ngrok-free.dev/tableau-mcp',
  '{}',
  1,
  'unknown',
  CURRENT_TIMESTAMP,
  'migration'
WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE server_id='tableau-http');

INSERT INTO mcp_servers(
  server_id, name, prefix, transport, command, args, base_url, env_public,
  enabled, status, updated_at, updated_by
)
SELECT
  'jira-http',
  'Jira MCP - HTTP',
  'jira',
  'http',
  NULL,
  '[]',
  'https://yahoo-trash-overeater.ngrok-free.dev/jira-mcp',
  '{}',
  1,
  'unknown',
  CURRENT_TIMESTAMP,
  'migration'
WHERE NOT EXISTS (SELECT 1 FROM mcp_servers WHERE server_id='jira-http');
