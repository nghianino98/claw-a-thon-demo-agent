import { getDb } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

const SECRET_INFO = "agent-connection";

export type AgentConnectionStatus = "unknown" | "connected" | "error";

export type AgentConnection = {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  status: AgentConnectionStatus;
  lastError: string;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasApiKey: boolean;
  hasAdminToken: boolean;
};

export type AgentConnectionWithSecrets = AgentConnection & {
  apiKey: string;
  adminToken: string;
};

type AgentConnectionRow = {
  id: string;
  name: string;
  base_url: string;
  api_key_encrypted: Buffer | null;
  admin_token_encrypted: Buffer | null;
  enabled: number;
  is_default: number;
  status: AgentConnectionStatus;
  last_error: string | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
};

export function normalizeAgentConnectionId(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

export function normalizeBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("invalid_base_url");
  }
  url.hash = "";
  return url.toString();
}

export function buildAgentUrl(baseUrl: string, path: string) {
  const base = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(path.replace(/^\//, ""), base);
}

function readSecret(buffer: Buffer | null) {
  if (!buffer) return "";
  try {
    return decrypt(buffer, SECRET_INFO);
  } catch {
    return "";
  }
}

export function encryptAgentSecret(value: string) {
  if (!process.env.DIDI_APP_SECRET || process.env.DIDI_APP_SECRET.length < 32) {
    throw new Error("DIDI_APP_SECRET is required to store agent connection secrets");
  }
  return encrypt(value, SECRET_INFO);
}

export function publicAgentConnection(row: AgentConnectionRow): AgentConnection {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    enabled: Boolean(row.enabled),
    isDefault: Boolean(row.is_default),
    status: row.status || "unknown",
    lastError: row.last_error || "",
    lastCheckedAt: row.last_checked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasApiKey: Boolean(row.api_key_encrypted),
    hasAdminToken: Boolean(row.admin_token_encrypted),
  };
}

export function connectionWithSecrets(row: AgentConnectionRow): AgentConnectionWithSecrets {
  return {
    ...publicAgentConnection(row),
    apiKey: readSecret(row.api_key_encrypted),
    adminToken: readSecret(row.admin_token_encrypted),
  };
}

export function listAgentConnections(userId: number | null = null) {
  const db = getDb();
  if (userId !== null) {
    const rows = db
      .prepare(
        `
        SELECT * FROM agent_connections
        WHERE user_id = ? OR user_id IS NULL
        ORDER BY is_default DESC, enabled DESC, name COLLATE NOCASE ASC
      `,
      )
      .all(userId) as AgentConnectionRow[];
    return rows.map(publicAgentConnection);
  }
  const rows = db
    .prepare(
      `
      SELECT * FROM agent_connections
      ORDER BY is_default DESC, enabled DESC, name COLLATE NOCASE ASC
    `,
    )
    .all() as AgentConnectionRow[];
  return rows.map(publicAgentConnection);
}

export function getAgentConnectionRow(id: string, userId: number | null = null) {
  const db = getDb();
  if (userId !== null) {
    return db
      .prepare("SELECT * FROM agent_connections WHERE id = ? AND (user_id = ? OR user_id IS NULL)")
      .get(id, userId) as AgentConnectionRow | undefined;
  }
  return db.prepare("SELECT * FROM agent_connections WHERE id = ?").get(id) as AgentConnectionRow | undefined;
}

export function getAgentConnection(id: string, userId: number | null = null) {
  const row = getAgentConnectionRow(id, userId);
  return row ? publicAgentConnection(row) : null;
}

export function getAgentConnectionWithSecrets(id: string, userId: number | null = null) {
  const row = getAgentConnectionRow(id, userId);
  return row ? connectionWithSecrets(row) : null;
}

export function getDefaultAgentConnectionWithSecrets(userId: number | null = null) {
  const db = getDb();
  if (userId !== null) {
    const row = db
      .prepare(
        `
        SELECT * FROM agent_connections
        WHERE enabled = 1 AND (user_id = ? OR user_id IS NULL)
        ORDER BY is_default DESC, updated_at DESC
        LIMIT 1
      `,
      )
      .get(userId) as AgentConnectionRow | undefined;
    return row ? connectionWithSecrets(row) : null;
  }
  const row = db
    .prepare(
      `
      SELECT * FROM agent_connections
      WHERE enabled = 1
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1
    `,
    )
    .get() as AgentConnectionRow | undefined;
  return row ? connectionWithSecrets(row) : null;
}

export function markOnlyDefault(id: string, userId: number | null = null) {
  const db = getDb();
  if (userId !== null) {
    db.prepare("UPDATE agent_connections SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END WHERE user_id = ? OR id = ?").run(id, userId, id);
    return;
  }
  db.prepare("UPDATE agent_connections SET is_default = CASE WHEN id = ? THEN 1 ELSE 0 END").run(id);
}
