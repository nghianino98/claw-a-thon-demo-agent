type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function bool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : value === 1 ? true : value === 0 ? false : fallback;
}

function num(value: unknown, fallback = 0) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type BotPlatform = "telegram" | "whatsapp" | "zalo";

export interface BotConnection {
  id: string;
  platform: BotPlatform;
  name: string;
  agentConnectionId: string | null;
  botUsername: string | null;
  enabled: boolean;
  status: "unknown" | "connected" | "error";
  lastError: string;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasToken: boolean;
}

function platform(value: unknown): BotPlatform {
  return value === "whatsapp" || value === "zalo" ? value : "telegram";
}

export function normalizeBotConnections(data: unknown): BotConnection[] {
  const root = asRecord(data);
  return asArray(root.connections ?? root.items ?? root.data).map((item) => {
    const row = asRecord(item);
    const status = str(row.status, "unknown");
    return {
      id: str(row.id),
      platform: platform(row.platform),
      name: str(row.name ?? row.id),
      agentConnectionId: str(row.agentConnectionId ?? row.agent_connection_id) || null,
      botUsername: str(row.botUsername ?? row.bot_username) || null,
      enabled: bool(row.enabled, true),
      status: status === "connected" || status === "error" ? status : "unknown",
      lastError: str(row.lastError ?? row.last_error),
      lastCheckedAt: num(row.lastCheckedAt ?? row.last_checked_at) || null,
      createdAt: num(row.createdAt ?? row.created_at),
      updatedAt: num(row.updatedAt ?? row.updated_at),
      hasToken: bool(row.hasToken ?? row.has_token),
    };
  });
}

export interface BotConnectionTestResult {
  ok: boolean;
  skipped: boolean;
  status: "connected" | "error";
  botUsername: string;
  error: string;
}

export function normalizeBotConnectionTestResult(data: unknown): BotConnectionTestResult {
  const root = asRecord(data);
  const status = str(root.status, "error");
  return {
    ok: bool(root.ok),
    skipped: bool(root.skipped),
    status: status === "connected" ? "connected" : "error",
    botUsername: str(root.botUsername),
    error: str(root.error),
  };
}
