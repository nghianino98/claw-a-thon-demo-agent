import { apiFetch } from "@/lib/api/client";

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownRecord)
    : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function firstArray(value: unknown, keys: string[]) {
  const record = asRecord(value);
  for (const key of keys) {
    const item = parseJsonString(record[key]);
    if (Array.isArray(item)) return item;
  }
  const parsed = parseJsonString(value);
  return Array.isArray(parsed) ? parsed : [];
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

function timestamp(value: unknown) {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return num(value, 0);
}

function stringList(value: unknown) {
  if (typeof value === "string") {
    return value
      .split(/[|,\n]/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return asArray(value).filter((item): item is string => typeof item === "string");
}

function normalizeRunStatus(value: unknown): "success" | "failure" | "running" | "cancelled" {
  const raw = str(value, "running").toLowerCase();
  if (["success", "done", "completed", "complete", "succeeded"].includes(raw)) return "success";
  if (["failure", "failed", "error"].includes(raw)) return "failure";
  if (["cancelled", "canceled"].includes(raw)) return "cancelled";
  return "running";
}

export interface AgentStatusData {
  activeModel: string;
  appVersion: string;
  kbVersion: string;
  kbAvailable: boolean;
  skillsCount: number;
  workflowsCount: number;
  runsCount: number;
  mcpServersCount: number;
  allowedUsersCount: number;
  runningJobsCount: number;
  systemStatus: "healthy" | "degraded" | "error";
  llmCallsLast7Days: { date: string; count: number }[];
  lastBackupAt: number | null;
  warnings: string[];
}

export interface AgentAuditLog {
  id: string;
  actor: string;
  action: string;
  target: string;
  timestamp: number;
  status: "success" | "failure";
  details?: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  commandAlias: string;
  instructions: string;
  source: string;
  showInMenu: boolean;
  triggers: string[];
}

export interface AgentWorkflow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  cronSchedule: string;
  enabled: boolean;
  lastRunAt: number | null;
  lastRunStatus: "success" | "failure" | "running" | "cancelled" | null;
  commandAlias: string;
  showInMenu: boolean;
}

export interface AgentRun {
  id: string;
  jobName: string;
  triggeredBy: string;
  createdAt: number;
  completedAt: number | null;
  status: "success" | "failure" | "running" | "cancelled";
  artifacts?: { name: string; url: string }[];
}

export interface AgentRunDetail {
  status: "success" | "failure" | "running" | "cancelled";
  logs: string;
  artifacts: { name: string; url: string }[];
}

export interface AgentKbVersion {
  version: string;
  type: "full" | "delta";
  sizeBytes: number;
  createdAt: number;
  active: boolean;
  files: number;
  chunks: number;
  changeSummary: string;
}

export interface AgentSearchResult {
  filePath: string;
  score: number;
  content: string;
}

export interface AgentAccessUser {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string;
  lastName: string | null;
  status: "pending" | "approved" | "rejected" | "revoked";
  requestedAt: number;
  decidedAt: number | null;
  decidedBy: string | null;
}

export interface AgentModelProfile {
  name: string;
  provider: string;
  modelCode: string;
  temperature: number;
}

export interface AgentMappingProfile {
  pattern: string;
  modelName: string;
}

export interface AgentSettingRow {
  key: string;
  value: string;
  updatedAt: number | null;
  updatedBy: string;
  writable: boolean;
}

export interface AgentSettings {
  maxBudgetUsd: number;
  currentSpendUsd: number;
  telegramWhitelistGroupIds: string[];
  modelProfiles: AgentModelProfile[];
  mappingProfiles: AgentMappingProfile[];
  settingsRows: AgentSettingRow[];
}

export interface AgentMcpServer {
  id: string;
  name: string;
  prefix: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  baseUrl: string;
  envPublic: Record<string, string>;
  enabled: boolean;
  status: "unknown" | "connected" | "error";
  lastError: string;
  lastCheckedAt: string;
  toolCount: number;
  secretKeys: string[];
}

export interface AgentMcpTestResult {
  status: "connected" | "error";
  toolCount: number;
  tools: string[];
  error: string;
}

export function normalizeStatus(data: unknown): AgentStatusData {
  const root = asRecord(data);
  const status = asRecord(root.status);
  const kb = asRecord(root.kb ?? status.kb);
  const warnings = stringList(root.warnings ?? status.warnings);
  const calls = firstArray(root, ["llmCallsLast7Days", "llm_calls_last_7_days", "llm_calls"]);
  const kbVersion = str(
    root.kbVersion ??
      root.kb_version ??
      root.kb_version_active ??
      kb.kb_version ??
      kb.version ??
      status.kbVersion ??
      status.kb_version,
    "N/A",
  );
  const systemStatus = str(
    root.systemStatus ?? root.system_status ?? status.systemStatus ?? root.status,
    warnings.length ? "degraded" : "healthy",
  );

  return {
    activeModel: str(root.activeModel ?? root.active_model ?? status.activeModel ?? status.active_model, "N/A"),
    appVersion: str(root.appVersion ?? root.app_version ?? root.version ?? status.appVersion ?? status.app_version, "N/A"),
    kbVersion,
    kbAvailable: bool(kb.available ?? root.kbAvailable ?? root.kb_available, kbVersion !== "N/A" && kbVersion !== ""),
    skillsCount: num(root.skillsCount ?? root.skills_count ?? root.skills),
    workflowsCount: num(root.workflowsCount ?? root.workflows_count ?? root.workflows),
    runsCount: num(root.runsCount ?? root.runs_count ?? root.runs),
    mcpServersCount: num(root.mcpServersCount ?? root.mcp_servers_count ?? root.mcp_servers),
    allowedUsersCount: num(root.allowedUsersCount ?? root.allowed_users_count ?? root.telegram_allowed_users),
    runningJobsCount: num(root.runningJobsCount ?? root.running_jobs_count ?? root.running_runs_count),
    systemStatus: (["healthy", "degraded", "error"].includes(systemStatus) ? systemStatus : "healthy") as AgentStatusData["systemStatus"],
    llmCallsLast7Days: calls.map((item) => {
      const call = asRecord(item);
      return {
        date: str(call.date ?? call.day, "-"),
        count: num(call.count ?? call.calls ?? call.total),
      };
    }),
    lastBackupAt: timestamp(root.lastBackupAt ?? root.last_backup_at) || null,
    warnings,
  };
}

export function normalizeAuditLog(value: unknown): AgentAuditLog {
  const row = asRecord(value);
  const action = str(row.action, "unknown");
  return {
    id: str(row.id ?? row.audit_id, `${timestamp(row.timestamp ?? row.created_at)}-${action}`),
    actor: str(row.actor ?? row.username, "system"),
    action,
    target: str(row.target ?? row.resource, "-"),
    timestamp: timestamp(row.timestamp ?? row.createdAt ?? row.created_at ?? row.time),
    status: str(row.status, action.includes("denied") ? "failure" : "success") === "failure" ? "failure" : "success",
    details: str(row.details ?? row.message, ""),
  };
}

export function normalizeAuditList(data: unknown) {
  const root = asRecord(data);
  const logs = firstArray(root, ["logs", "audit", "items", "data"]).map(normalizeAuditLog);
  return {
    logs,
    total: num(root.total ?? root.count, logs.length),
    nextBefore: str(root.nextBefore ?? root.next_before, ""),
  };
}

export function normalizeSkills(data: unknown): AgentSkill[] {
  const root = asRecord(data);
  return firstArray(root, ["skills", "items", "data"]).map((item) => {
    const row = asRecord(item);
    return {
      id: str(row.id ?? row.skill_id),
      name: str(row.name ?? row.title ?? row.id),
      description: str(row.description),
      enabled: bool(row.enabled, true),
      commandAlias: str(row.commandAlias ?? row.command_alias),
      instructions: str(row.instructions ?? row.content_override ?? row.content),
      source: str(row.source, "agent"),
      showInMenu: bool(row.showInMenu ?? row.show_in_menu, true),
      triggers: stringList(row.triggers),
    };
  });
}

export function normalizeWorkflows(data: unknown): AgentWorkflow[] {
  const root = asRecord(data);
  return firstArray(root, ["workflows", "items", "data"]).map((item) => {
    const row = asRecord(item);
    const lastStatus = row.lastRunStatus ?? row.last_run_status;
    return {
      id: str(row.id ?? row.workflow_id),
      name: str(row.name ?? row.title ?? row.id),
      description: str(row.description),
      instructions: str(row.instructions ?? row.content_override ?? row.content),
      cronSchedule: str(row.cronSchedule ?? row.cron_schedule ?? row.schedule),
      enabled: bool(row.enabled, true),
      lastRunAt: timestamp(row.lastRunAt ?? row.last_run_at) || null,
      lastRunStatus: lastStatus ? normalizeRunStatus(lastStatus) : null,
      commandAlias: str(row.commandAlias ?? row.command_alias),
      showInMenu: bool(row.showInMenu ?? row.show_in_menu, true),
    };
  });
}

function normalizeArtifacts(raw: unknown, runId: string) {
  return asArray(parseJsonString(raw)).map((artifact) => {
    const itemRecord = asRecord(artifact);
    const rawName = typeof artifact === "string" ? artifact : str(itemRecord.name ?? itemRecord.file ?? itemRecord.path, "artifact");
    const name = rawName.includes("/") ? rawName.split("/").pop() || rawName : rawName;
    return {
      name,
      url: str(itemRecord.url, `/api/agent-admin/runs/${runId}/artifacts/${encodeURIComponent(name)}`),
    };
  });
}

export function normalizeRuns(data: unknown): AgentRun[] {
  const root = asRecord(data);
  return firstArray(root, ["runs", "items", "data"]).map((item) => {
    const row = asRecord(item);
    const id = str(row.id ?? row.run_id);
    const artifacts = normalizeArtifacts(row.artifacts, id);
    return {
      id,
      jobName: str(row.jobName ?? row.job_name ?? row.workflow_id ?? row.skill_id ?? row.name, "-"),
      triggeredBy: str(row.triggeredBy ?? row.triggered_by ?? row.actor, "system"),
      createdAt: timestamp(row.createdAt ?? row.created_at ?? row.started_at),
      completedAt: timestamp(row.completedAt ?? row.completed_at ?? row.finished_at) || null,
      status: normalizeRunStatus(row.status),
      artifacts,
    };
  });
}

export function normalizeRunDetail(data: unknown): AgentRunDetail {
  const root = asRecord(data);
  const row = asRecord(root.run ?? data);
  const stepLogs = asArray(parseJsonString(row.steps))
    .map((step) => {
      const item = asRecord(step);
      return [str(item.name), str(item.status), str(item.log ?? item.message)].filter(Boolean).join(" - ");
    })
    .filter(Boolean)
    .join("\n");
  const logs = str(row.logs ?? row.log ?? row.output, stepLogs);
  return {
    status: normalizeRunStatus(row.status),
    logs,
    artifacts: normalizeArtifacts(row.artifacts, str(row.id ?? row.run_id)),
  };
}

export function normalizeMcpServers(data: unknown): AgentMcpServer[] {
  const root = asRecord(data);
  return firstArray(root, ["servers", "items", "data"]).map((item) => {
    const row = asRecord(item);
    const env = asRecord(parseJsonString(row.envPublic ?? row.env_public));
    return {
      id: str(row.id ?? row.server_id),
      name: str(row.name),
      prefix: str(row.prefix),
      transport: str(row.transport, "stdio") === "http" ? "http" : "stdio",
      command: str(row.command),
      args: stringList(parseJsonString(row.args)),
      baseUrl: str(row.baseUrl ?? row.base_url),
      envPublic: Object.fromEntries(Object.entries(env).map(([key, value]) => [key, String(value ?? "")])),
      enabled: bool(row.enabled),
      status: str(row.status, "unknown") as AgentMcpServer["status"],
      lastError: str(row.lastError ?? row.last_error),
      lastCheckedAt: str(row.lastCheckedAt ?? row.last_checked_at),
      toolCount: num(row.toolCount ?? row.tool_count),
      secretKeys: stringList(row.secretKeys ?? row.secret_keys),
    };
  });
}

export function normalizeMcpTestResult(data: unknown): AgentMcpTestResult {
  const root = asRecord(data);
  const row = asRecord(root.result ?? data);
  return {
    status: str(row.status, "error") === "connected" ? "connected" : "error",
    toolCount: num(row.toolCount ?? row.tool_count),
    tools: stringList(row.tools),
    error: str(row.error),
  };
}

export function normalizeKbVersions(data: unknown): AgentKbVersion[] {
  const root = asRecord(data);
  return firstArray(root, ["versions", "items", "data"]).map((item) => {
    const row = asRecord(item);
    const rawStatus = str(row.status).toLowerCase();
    return {
      version: str(row.version ?? row.id ?? row.version_id),
      type: str(row.type ?? row.kind, "full") === "delta" ? "delta" : "full",
      sizeBytes: num(row.sizeBytes ?? row.size_bytes ?? row.total_bytes ?? row.bytes),
      createdAt: timestamp(row.createdAt ?? row.created_at),
      active: bool(row.active ?? row.is_active, rawStatus === "active"),
      files: num(row.files ?? row.file_count ?? row.files_count),
      chunks: num(row.chunks ?? row.chunk_count ?? row.chunks_count),
      changeSummary: str(row.changeSummary ?? row.change_summary),
    };
  });
}

export function normalizeSearchResults(data: unknown): AgentSearchResult[] {
  const root = asRecord(data);
  return firstArray(root, ["results", "items", "data"]).map((item) => {
    const row = asRecord(item);
    return {
      filePath: str(row.filePath ?? row.file_path ?? row.path, "-"),
      score: num(row.score),
      content: str(row.content ?? row.snippet ?? row.text),
    };
  });
}

export function normalizeAccessUsers(data: unknown): AgentAccessUser[] {
  const root = asRecord(data);
  return firstArray(root, ["users", "access", "items", "data"]).map((item) => {
    const row = asRecord(item);
    const rawStatus = str(row.status, "pending").toLowerCase();
    const status =
      rawStatus === "allowed" || rawStatus === "approved"
        ? "approved"
        : rawStatus === "revoked"
          ? "revoked"
          : rawStatus === "rejected"
            ? "rejected"
            : "pending";
    const id = str(row.id ?? row.user_id ?? row.tg_user_id ?? row.telegramId ?? row.telegram_id);
    const displayName = str(row.displayName ?? row.display_name ?? row.firstName ?? row.first_name ?? row.name);
    return {
      id,
      telegramId: str(row.telegramId ?? row.telegram_id ?? row.tg_user_id ?? row.user_id ?? id),
      username: str(row.username) || null,
      firstName: displayName || str(row.user_id ?? id, "-"),
      lastName: str(row.lastName ?? row.last_name) || null,
      status,
      requestedAt: timestamp(row.requestedAt ?? row.requested_at ?? row.created_at),
      decidedAt: timestamp(row.decidedAt ?? row.decided_at ?? row.updated_at) || null,
      decidedBy: str(row.decidedBy ?? row.decided_by ?? row.approved_by) || null,
    };
  });
}

const WRITABLE_AGENT_SETTING_KEYS = new Set([
  "kb_sync_activate",
  "workflow_enabled",
  "model_routing",
  "registry_version",
  "rate_limit_per_minute",
  "rate_limit_per_day",
]);

export function normalizeSettings(data: unknown): AgentSettings {
  const root = asRecord(data);
  const runtime = asRecord(root.runtime);
  const settingsRows = firstArray(root, ["settings", "items", "data"]).map((item) => {
    const row = asRecord(item);
    const key = str(row.key);
    return {
      key,
      value: str(row.value),
      updatedAt: timestamp(row.updatedAt ?? row.updated_at) || null,
      updatedBy: str(row.updatedBy ?? row.updated_by, "-"),
      writable: WRITABLE_AGENT_SETTING_KEYS.has(key),
    };
  });
  const rawModelProfiles = firstArray(root, ["modelProfiles", "model_profiles"]);
  const rawRouting = firstArray(root, ["mappingProfiles", "model_routing", "routing"]);
  const rowValue = (key: string) => settingsRows.find((row) => row.key === key)?.value;
  const modelRoutingFromSettings = parseJsonString(rowValue("model_routing"));
  const routingFromSettings = Array.isArray(modelRoutingFromSettings)
    ? modelRoutingFromSettings
    : asArray(asRecord(modelRoutingFromSettings).routing);
  return {
    maxBudgetUsd: num(root.maxBudgetUsd ?? root.max_budget_usd ?? runtime.maxBudgetUsd ?? runtime.max_budget_usd),
    currentSpendUsd: num(root.currentSpendUsd ?? root.current_spend_usd ?? runtime.currentSpendUsd ?? runtime.current_spend_usd),
    telegramWhitelistGroupIds: stringList(root.telegramWhitelistGroupIds ?? root.telegram_whitelist_group_ids),
    modelProfiles: rawModelProfiles.map((item) => {
      const row = asRecord(item);
      return {
        name: str(row.name),
        provider: str(row.provider),
        modelCode: str(row.modelCode ?? row.model_code),
        temperature: num(row.temperature, 0.2),
      };
    }),
    mappingProfiles: (rawRouting.length ? rawRouting : routingFromSettings).map((item) => {
      const row = asRecord(item);
      return {
        pattern: str(row.pattern ?? row.class),
        modelName: str(row.modelName ?? row.model_name ?? row.model),
      };
    }),
    settingsRows,
  };
}

export async function fetchAgentAdmin<T>(path: string, normalizer: (data: unknown) => T) {
  return normalizer(await apiFetch(`/api/agent-admin/${path}`));
}
