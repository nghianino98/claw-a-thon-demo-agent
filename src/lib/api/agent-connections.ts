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

export interface AgentConnection {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  isDefault: boolean;
  status: "unknown" | "connected" | "error";
  lastError: string;
  lastCheckedAt: number | null;
  createdAt: number;
  updatedAt: number;
  hasApiKey: boolean;
  hasAdminToken: boolean;
}

export interface AgentConnectionTestResult {
  status: "connected" | "error";
  health: {
    ok: boolean;
    statusCode: number;
    body: unknown;
    error: string;
  };
  admin: {
    ok: boolean;
    statusCode: number;
    skipped: boolean;
    error: string;
  };
  invocation: {
    ok: boolean;
    statusCode: number;
    skipped: boolean;
    error: string;
  };
  warnings: string[];
}

export function normalizeAgentConnections(data: unknown): AgentConnection[] {
  const root = asRecord(data);
  return asArray(root.connections ?? root.items ?? root.data).map((item) => {
    const row = asRecord(item);
    const status = str(row.status, "unknown");
    return {
      id: str(row.id),
      name: str(row.name ?? row.id),
      baseUrl: str(row.baseUrl ?? row.base_url),
      enabled: bool(row.enabled, true),
      isDefault: bool(row.isDefault ?? row.is_default),
      status: status === "connected" || status === "error" ? status : "unknown",
      lastError: str(row.lastError ?? row.last_error),
      lastCheckedAt: num(row.lastCheckedAt ?? row.last_checked_at) || null,
      createdAt: num(row.createdAt ?? row.created_at),
      updatedAt: num(row.updatedAt ?? row.updated_at),
      hasApiKey: bool(row.hasApiKey ?? row.has_api_key),
      hasAdminToken: bool(row.hasAdminToken ?? row.has_admin_token),
    };
  });
}

export function normalizeAgentConnectionTestResult(data: unknown): AgentConnectionTestResult {
  const root = asRecord(data);
  const status = str(root.status, "error");
  const health = asRecord(root.health);
  const admin = asRecord(root.admin);
  const invocation = asRecord(root.invocation);
  return {
    status: status === "connected" ? "connected" : "error",
    health: {
      ok: bool(health.ok),
      statusCode: num(health.statusCode ?? health.status_code),
      body: health.body,
      error: str(health.error),
    },
    admin: {
      ok: bool(admin.ok),
      statusCode: num(admin.statusCode ?? admin.status_code),
      skipped: bool(admin.skipped),
      error: str(admin.error),
    },
    invocation: {
      ok: bool(invocation.ok),
      statusCode: num(invocation.statusCode ?? invocation.status_code),
      skipped: bool(invocation.skipped),
      error: str(invocation.error),
    },
    warnings: asArray(root.warnings).filter((item): item is string => typeof item === "string"),
  };
}

export function agentAdminPath(connectionId: string, path: string) {
  return `/api/agent-connects/${encodeURIComponent(connectionId)}/admin/${path.replace(/^\//, "")}`;
}

export function agentRunArtifactPath(connectionId: string, runId: string, artifactName: string) {
  return agentAdminPath(connectionId, `runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactName)}`);
}
