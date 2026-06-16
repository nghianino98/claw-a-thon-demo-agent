import { getDb } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

const SECRET_INFO = "bot-connection";

export type BotPlatform = "telegram" | "whatsapp" | "zalo";
export type BotConnectionStatus = "unknown" | "connected" | "error";

export const BOT_PLATFORMS: BotPlatform[] = ["telegram", "whatsapp", "zalo"];

export type BotConnection = {
  id: string;
  platform: BotPlatform;
  name: string;
  agentConnectionId: string | null;
  botUsername: string | null;
  enabled: boolean;
  status: BotConnectionStatus;
  lastError: string;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasToken: boolean;
};

export type BotConnectionWithSecret = BotConnection & { token: string };

type BotConnectionRow = {
  id: string;
  platform: BotPlatform;
  name: string;
  token_encrypted: Buffer | null;
  agent_connection_id: string | null;
  bot_username: string | null;
  enabled: number;
  status: BotConnectionStatus;
  last_error: string | null;
  last_checked_at: number | null;
  created_at: number;
  updated_at: number;
};

export function isBotPlatform(value: unknown): value is BotPlatform {
  return typeof value === "string" && (BOT_PLATFORMS as string[]).includes(value);
}

export function normalizeBotConnectionId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 64);
}

function readSecret(buffer: Buffer | null) {
  if (!buffer) return "";
  try {
    return decrypt(buffer, SECRET_INFO);
  } catch {
    return "";
  }
}

export function encryptBotSecret(value: string) {
  if (!process.env.DIDI_APP_SECRET || process.env.DIDI_APP_SECRET.length < 32) {
    throw new Error("DIDI_APP_SECRET is required to store bot connection secrets");
  }
  return encrypt(value, SECRET_INFO);
}

export function publicBotConnection(row: BotConnectionRow): BotConnection {
  return {
    id: row.id,
    platform: row.platform,
    name: row.name,
    agentConnectionId: row.agent_connection_id || null,
    botUsername: row.bot_username || null,
    enabled: Boolean(row.enabled),
    status: row.status || "unknown",
    lastError: row.last_error || "",
    lastCheckedAt: row.last_checked_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasToken: Boolean(row.token_encrypted),
  };
}

export function listBotConnections() {
  const rows = getDb()
    .prepare(
      `
      SELECT * FROM bot_connections
      ORDER BY enabled DESC, platform ASC, name COLLATE NOCASE ASC
    `,
    )
    .all() as BotConnectionRow[];
  return rows.map(publicBotConnection);
}

export function getBotConnectionRow(id: string) {
  return getDb().prepare("SELECT * FROM bot_connections WHERE id = ?").get(id) as BotConnectionRow | undefined;
}

export function getBotConnection(id: string) {
  const row = getBotConnectionRow(id);
  return row ? publicBotConnection(row) : null;
}

export function getBotConnectionWithSecret(id: string): BotConnectionWithSecret | null {
  const row = getBotConnectionRow(id);
  if (!row) return null;
  return { ...publicBotConnection(row), token: readSecret(row.token_encrypted) };
}
