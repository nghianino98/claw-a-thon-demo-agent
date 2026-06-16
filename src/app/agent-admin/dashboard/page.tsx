"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ErrorState } from "@/components/ui/error-state";
import { Button } from "@/components/ui/button";
import { RoleGate } from "@/components/ui/role-gate";
import { Textarea } from "@/components/ui/textarea";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import {
  normalizeAuditList,
  normalizeStatus,
  normalizeAccessUsers,
  normalizeMcpServers,
  normalizeSettings,
  type AgentAuditLog,
  type AgentStatusData,
  type AgentAccessUser,
  type AgentMcpServer,
  type AgentSettingRow,
  type AgentSettings,
} from "@/lib/api/agent-admin";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { format } from "date-fns";
import {
  RefreshCw,
  Save,
  Loader2,
  Lock,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Usage tab helpers
// ─────────────────────────────────────────────────────────────────────────────
interface UsageModel {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number | null;
  priced: boolean;
}
interface UsageSeries {
  bucket: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number | null;
}
interface UsageData {
  range: { from: string; to: string; bucket: string };
  totals: {
    requests: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    avg_latency_ms: number;
    cost_usd: number | null;
  };
  by_model: UsageModel[];
  by_purpose: { purpose: string; requests: number; total_tokens: number }[];
  series: UsageSeries[];
  pricing: Record<string, { input_per_1m: number; output_per_1m: number }>;
  currency: string;
}

const USAGE_RANGES = [
  { key: "7", labelVi: "7 ngày", labelEn: "7 days" },
  { key: "30", labelVi: "30 ngày", labelEn: "30 days" },
  { key: "90", labelVi: "90 ngày", labelEn: "90 days" },
];

const PALETTE = ["#0144DB", "#7c3aed", "#059669", "#d97706", "#db2777", "#0891b2", "#65a30d"];

function fmtInt(n: number) {
  return new Intl.NumberFormat("vi-VN").format(Math.round(n || 0));
}
function fmtTokens(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n || 0);
}
function fmtCost(n: number | null) {
  if (n === null || n === undefined) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return "$" + n.toFixed(4);
  return "$" + n.toFixed(2);
}

function TimeSeriesChart({
  series,
  byModel = [],
  metric,
}: {
  series: UsageSeries[];
  byModel?: UsageModel[];
  metric: "requests" | "tokens";
}) {
  const [hovered, setHovered] = React.useState<{
    index: number;
    x: number;
    y: number;
    series: UsageSeries;
  } | null>(null);

  if (!series.length) {
    return <div className="flex items-center justify-center h-48 text-sm text-zinc-400">Chưa có dữ liệu trong khoảng này</div>;
  }
  const W = 720, H = 200, padL = 44, padB = 28, padT = 10, padR = 10;
  const innerW = W - padL - padR, innerH = H - padT - padB;
  const vals = series.map((s) => (metric === "requests" ? s.requests : s.prompt_tokens + s.completion_tokens));
  const max = Math.max(1, ...vals);
  const n = series.length;
  const slot = innerW / n;
  const barW = Math.min(40, slot * 0.62);
  const yTicks = 4;
  const labelEvery = Math.ceil(n / 12);

  // Compute model ratios based on total metrics over the range
  const totalRequests = byModel.reduce((acc, m) => acc + m.requests, 0);
  const totalTokens = byModel.reduce((acc, m) => acc + (m.total_tokens || m.prompt_tokens + m.completion_tokens), 0);

  const modelRatios = byModel.map((m) => {
    const ratio =
      metric === "requests"
        ? totalRequests > 0
          ? m.requests / totalRequests
          : 0
        : totalTokens > 0
        ? (m.total_tokens || m.prompt_tokens + m.completion_tokens) / totalTokens
        : 0;
    return {
      model: m.model,
      ratio,
    };
  });

  const hasModels = byModel.length > 0;

  return (
    <div className="relative w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {Array.from({ length: yTicks + 1 }).map((_, i) => {
          const y = padT + (innerH * i) / yTicks;
          const v = max * (1 - i / yTicks);
          return (
            <g key={i}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#f1f5f9" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#94a3b8">
                {metric === "tokens" ? fmtTokens(v) : fmtInt(v)}
              </text>
            </g>
          );
        })}

        {/* Hover vertical alignment guideline */}
        {hovered && (
          <line
            x1={padL + slot * hovered.index + slot / 2}
            y1={padT}
            x2={padL + slot * hovered.index + slot / 2}
            y2={padT + innerH}
            stroke="#cbd5e1"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        )}

        {series.map((s, i) => {
          const x = padL + slot * i + (slot - barW) / 2;
          const totalVal = metric === "requests" ? s.requests : (s.prompt_tokens + s.completion_tokens);
          if (totalVal === 0) return null;

          if (!hasModels) {
            const h = (totalVal / max) * innerH;
            return <rect key={i} x={x} y={padT + innerH - h} width={barW} height={h} rx={3} fill="#0144DB" />;
          }

          // Draw stacked segments
          let currentY = padT + innerH;
          return (
            <g key={i}>
              {modelRatios.map((mr, j) => {
                const segVal = totalVal * mr.ratio;
                const h = (segVal / max) * innerH;
                if (h <= 0) return null;
                const y = currentY - h;
                currentY = y;
                return (
                  <rect
                    key={mr.model}
                    x={x}
                    y={y}
                    width={barW}
                    height={h}
                    fill={PALETTE[j % PALETTE.length]}
                  />
                );
              })}
            </g>
          );
        })}
        {series.map((s, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={padL + slot * i + slot / 2} y={H - 8} textAnchor="middle" fontSize={9} fill="#64748b">
              {s.bucket.length > 10 ? s.bucket.slice(5).replace("T", " ") : s.bucket.slice(5)}
            </text>
          ) : null
        )}

        {/* Invisible overlay rects for hover detection */}
        {series.map((s, i) => {
          const x = padL + slot * i;
          const totalVal = metric === "requests" ? s.requests : (s.prompt_tokens + s.completion_tokens);
          const topY = padT + innerH - (totalVal / max) * innerH;
          return (
            <rect
              key={`overlay-${i}`}
              x={x}
              y={padT}
              width={slot}
              height={innerH}
              fill="transparent"
              className="cursor-pointer"
              onMouseEnter={() => {
                const pctX = ((x + slot / 2) / W) * 100;
                const pctY = (topY / H) * 100;
                setHovered({
                  index: i,
                  x: pctX,
                  y: pctY,
                  series: s,
                });
              }}
              onMouseMove={() => {
                const pctX = ((x + slot / 2) / W) * 100;
                const pctY = (topY / H) * 100;
                setHovered({
                  index: i,
                  x: pctX,
                  y: pctY,
                  series: s,
                });
              }}
              onMouseLeave={() => {
                setHovered(null);
              }}
            />
          );
        })}
      </svg>

      {/* HTML Overlay Tooltip */}
      {hovered && (
        <div
          className="absolute z-10 p-3 bg-zinc-900/95 backdrop-blur-xs text-white rounded-xl shadow-xl border border-zinc-800 text-[11px] pointer-events-none space-y-1 font-sans transition-all duration-75"
          style={{
            left: `${hovered.x}%`,
            top: `${hovered.y}%`,
            transform: "translate(-50%, -105%)",
          }}
        >
          <div className="font-bold text-zinc-300 border-b border-zinc-800 pb-1 mb-1 shrink-0 whitespace-nowrap">
            {hovered.series.bucket}
          </div>
          <div className="flex justify-between gap-6 whitespace-nowrap">
            <span className="text-zinc-400">Requests:</span>
            <span className="font-bold font-mono">{fmtInt(hovered.series.requests)}</span>
          </div>
          <div className="flex justify-between gap-6 whitespace-nowrap">
            <span className="text-zinc-400">Tokens:</span>
            <span className="font-bold font-mono">
              {fmtTokens(hovered.series.prompt_tokens + hovered.series.completion_tokens)}
            </span>
          </div>
          <div className="text-[10px] text-zinc-500 pl-2 whitespace-nowrap">
            <span>in: {fmtTokens(hovered.series.prompt_tokens)} · out: {fmtTokens(hovered.series.completion_tokens)}</span>
          </div>
          <div className="flex justify-between gap-6 whitespace-nowrap">
            <span className="text-zinc-400">Chi phí:</span>
            <span className="font-bold font-mono text-emerald-400">{fmtCost(hovered.series.cost_usd)}</span>
          </div>
        </div>
      )}
    </div>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// Settings tab helpers
// ─────────────────────────────────────────────────────────────────────────────
function displayValue(row: AgentSettingRow) {
  if (row.key !== "model_routing") return row.value;
  try {
    return JSON.stringify(JSON.parse(row.value), null, 2);
  } catch {
    return row.value;
  }
}

function parseSaveValue(key: string, value: string) {
  const trimmed = value.trim();
  if (key === "model_routing") return JSON.parse(trimmed);
  if (key === "workflow_enabled") {
    const lower = trimmed.toLowerCase();
    if (["1", "true", "enabled", "on", "yes"].includes(lower)) return "1";
    if (["0", "false", "disabled", "off", "no"].includes(lower)) return "0";
  }
  return trimmed;
}

function settingsToValues(rows: AgentSettingRow[]) {
  return Object.fromEntries(rows.map((row) => [row.key, displayValue(row)]));
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Page
// ─────────────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();

  // ── Overview state ──────────────────────────────────────────────────────────
  const [status, setStatus] = React.useState<AgentStatusData | null>(null);
  const [auditLogs, setAuditLogs] = React.useState<AgentAuditLog[]>([]);
  const [loadingOverview, setLoadingOverview] = React.useState(true);
  const [errorOverview, setErrorOverview] = React.useState<unknown>(null);

  // ── Usage state ─────────────────────────────────────────────────────────────
  const [usageDays, setUsageDays] = React.useState("30");
  const [usageMetric, setUsageMetric] = React.useState<"requests" | "tokens">("requests");
  const [usageData, setUsageData] = React.useState<UsageData | null>(null);
  const [loadingUsage, setLoadingUsage] = React.useState(true);
  const [errorUsage, setErrorUsage] = React.useState<unknown>(null);

  // ── Settings state ──────────────────────────────────────────────────────────
  const [settingsData, setSettingsData] = React.useState<AgentSettings | null>(null);
  const [mcpServers, setMcpServers] = React.useState<AgentMcpServer[]>([]);
  const [accessUsers, setAccessUsers] = React.useState<AgentAccessUser[]>([]);
  const [settingsValues, setSettingsValues] = React.useState<Record<string, string>>({});
  const [initialSettingsValues, setInitialSettingsValues] = React.useState<Record<string, string>>({});
  const [loadingSettings, setLoadingSettings] = React.useState(true);
  const [savingSettings, setSavingSettings] = React.useState(false);
  const [errorSettings, setErrorSettings] = React.useState<unknown>(null);

  // ── Load: Overview ──────────────────────────────────────────────────────────
  const loadOverview = React.useCallback(async () => {
    if (!selectedId) return;
    setLoadingOverview(true);
    setErrorOverview(null);
    try {
      const [statusData, auditData] = await Promise.all([
        apiFetch("/api/agent-admin/status").then(normalizeStatus),
        apiFetch("/api/agent-admin/audit?limit=10").then(normalizeAuditList),
      ]);
      setStatus(statusData);
      setAuditLogs(auditData.logs);
    } catch (err) {
      console.error(err);
      setErrorOverview(err);
      toast.error(t("dashLoadError"));
    } finally {
      setLoadingOverview(false);
    }
  }, [t, selectedId]);

  // ── Load: Usage ─────────────────────────────────────────────────────────────
  const loadUsage = React.useCallback(async () => {
    if (!selectedId) return;
    setLoadingUsage(true);
    setErrorUsage(null);
    try {
      const to = new Date();
      const from = new Date(to.getTime() - Number(usageDays) * 86400000);
      const bucket = "day";
      const qs = `from=${encodeURIComponent(from.toISOString().replace(/\.\d+Z$/, "Z"))}&to=${encodeURIComponent(
        to.toISOString().replace(/\.\d+Z$/, "Z")
      )}&bucket=${bucket}`;
      const res = (await apiFetch(`/api/agent-admin/usage?${qs}`)) as UsageData;
      setUsageData(res);
    } catch (err) {
      console.error(err);
      setErrorUsage(err);
    } finally {
      setLoadingUsage(false);
    }
  }, [selectedId, usageDays]);

  // ── Load: Settings ──────────────────────────────────────────────────────────
  const loadSettings = React.useCallback(async () => {
    setLoadingSettings(true);
    setErrorSettings(null);
    try {
      const [settingsPayload, mcpPayload, accessPayload] = await Promise.all([
        apiFetch("/api/agent-admin/settings"),
        apiFetch("/api/agent-admin/mcp/servers"),
        apiFetch("/api/agent-admin/access"),
      ]);
      const data = normalizeSettings(settingsPayload);
      const nextValues = settingsToValues(data.settingsRows);
      setSettingsData(data);
      setMcpServers(normalizeMcpServers(mcpPayload));
      setAccessUsers(normalizeAccessUsers(accessPayload));
      setSettingsValues(nextValues);
      setInitialSettingsValues(nextValues);
    } catch (err) {
      console.error(err);
      setErrorSettings(err);
      toast.error(t("settingAgentLoadError"));
    } finally {
      setLoadingSettings(false);
    }
  }, [t]);

  // ── Effects ─────────────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (selectedId) {
      loadOverview();
    } else {
      setStatus(null);
      setAuditLogs([]);
      setLoadingOverview(false);
    }
  }, [selectedId, loadOverview]);

  React.useEffect(() => {
    if (selectedId) loadUsage();
    else {
      setUsageData(null);
      setLoadingUsage(false);
    }
  }, [selectedId, loadUsage]);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // ── Actions ─────────────────────────────────────────────────────────────────


  const handleSaveSettings = async () => {
    if (savingSettings || !settingsData) return;
    setSavingSettings(true);
    try {
      const changed: Record<string, unknown> = {};
      for (const row of settingsData.settingsRows) {
        if (!row.writable) continue;
        const nextValue = settingsValues[row.key] ?? "";
        if (nextValue === initialSettingsValues[row.key]) continue;
        changed[row.key] = parseSaveValue(row.key, nextValue);
      }
      if (Object.keys(changed).length === 0) {
        toast.success(t("settingAgentNoChanges"));
        return;
      }
      await apiFetch("/api/agent-admin/settings", {
        method: "PATCH",
        body: JSON.stringify({ values: changed }),
      });
      toast.success(t("settingAgentSaveSuccess"));
      loadSettings();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof SyntaxError ? t("settingAgentInvalidJson") : t("settingAgentSaveError"));
    } finally {
      setSavingSettings(false);
    }
  };

  // ── Computed ─────────────────────────────────────────────────────────────────
  const usageTotals = usageData?.totals;
  const maxModelReq = Math.max(1, ...(usageData?.by_model.map((m) => m.requests) || [1]));
  const writableRows = settingsData?.settingsRows.filter((r) => r.writable) ?? [];
  const readOnlyRows = settingsData?.settingsRows.filter((r) => !r.writable) ?? [];
  const registryVersion = settingsValues.registry_version || "-";
  const workflowEnabled = settingsValues.workflow_enabled === "1" ? t("settingAgentEnabled") : t("settingAgentDisabled");
  const connectedMcpCount = mcpServers.filter((s) => s.status === "connected").length;
  const approvedAccessCount = accessUsers.filter((u) => u.status === "approved").length;



  return (
    <PageShell>
      <PageHeader
        title={t("navDashboard")}
        subtitle={t("dashSubtitle")}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <AgentConnectSelect onChange={() => { loadOverview(); loadUsage(); loadSettings(); }} />
          </div>
        }
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">Chọn Agent Connect để xem dữ liệu.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {/* Phân khu 1: Tổng quan trạng thái */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-100 pb-4 flex-wrap gap-4">
              <CardTitle className="text-base font-bold text-zinc-900">
                Tổng quan Trạng thái
              </CardTitle>
              <div className="flex items-center gap-2 text-xs font-semibold flex-wrap">
                <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${status?.systemStatus === "healthy" ? "bg-emerald-50 border-emerald-250 text-emerald-700" : "bg-amber-50 border-amber-250 text-amber-700"} shrink-0`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${status?.systemStatus === "healthy" ? "bg-emerald-500" : "bg-amber-500"} shrink-0`} />
                  System Health
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 border border-blue-150 text-blue-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  LLM API
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-150 text-indigo-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                  BFF Proxy
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-purple-50 border border-purple-150 text-purple-700">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                  Database
                </span>
              </div>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingOverview ? (
                <div className="h-32 bg-zinc-50 rounded-xl animate-pulse" />
              ) : errorOverview ? (
                <ErrorState errorType={getAgentErrorType(errorOverview)} onRetry={loadOverview} />
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
                  <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/20">
                    <span className="text-[10px] font-bold text-blue-500 uppercase tracking-wider">Phiên bản App</span>
                    <p className="mt-1 text-base font-extrabold text-blue-900">{status?.appVersion || "N/A"}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/20">
                    <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Tri thức (KB)</span>
                    <p className="mt-1 text-sm font-extrabold text-emerald-900 truncate" title={status?.kbVersion}>
                      {status?.kbAvailable ? status.kbVersion || "Available" : "Unavailable"}
                    </p>
                  </div>
                  <div className="p-4 rounded-xl border border-violet-100 bg-violet-50/20">
                    <span className="text-[10px] font-bold text-violet-600 uppercase tracking-wider">Skills / Workflows</span>
                    <p className="mt-1 text-base font-extrabold text-violet-900">{status?.skillsCount ?? 0} / {status?.workflowsCount ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-amber-100 bg-amber-50/20">
                    <span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">Lượt chạy (Runs)</span>
                    <p className="mt-1 text-base font-extrabold text-amber-900">{status?.runsCount ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-pink-100 bg-pink-50/20">
                    <span className="text-[10px] font-bold text-pink-600 uppercase tracking-wider">MCP Servers</span>
                    <p className="mt-1 text-base font-extrabold text-pink-900">{status?.mcpServersCount ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-cyan-100 bg-cyan-50/20">
                    <span className="text-[10px] font-bold text-cyan-600 uppercase tracking-wider">Running Jobs</span>
                    <p className="mt-1 text-base font-extrabold text-cyan-900">{status?.runningJobsCount ?? 0}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-zinc-200 bg-zinc-50/50">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Registry Version</span>
                    <p className="mt-1 text-sm font-extrabold text-zinc-900 truncate" title={registryVersion}>{registryVersion}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-teal-100 bg-teal-50/20">
                    <span className="text-[10px] font-bold text-teal-600 uppercase tracking-wider">Trạng thái quy trình</span>
                    <p className="mt-1 text-sm font-extrabold text-teal-900 truncate">{workflowEnabled}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/20">
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Quyền truy cập</span>
                    <p className="mt-1 text-base font-extrabold text-indigo-900">{approvedAccessCount}/{accessUsers.length}</p>
                  </div>
                  <div className="p-4 rounded-xl border border-fuchsia-100 bg-fuchsia-50/20">
                    <span className="text-[10px] font-bold text-fuchsia-600 uppercase tracking-wider">Model Mặc định</span>
                    <p className="mt-1 text-sm font-extrabold text-fuchsia-900 truncate" title={status?.activeModel}>
                      {status?.activeModel?.split("/").pop() || "N/A"}
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phân khu 2: Phân tích sử dụng LLM & Chi phí */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-100 pb-4 flex-wrap gap-4">
              <CardTitle className="text-base font-bold text-zinc-900">
                Phân tích Sử dụng LLM & Chi phí
              </CardTitle>
              {/* Controls */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1 bg-zinc-100 p-0.5 rounded-lg text-xs">
                  {USAGE_RANGES.map((r) => (
                    <button
                      key={r.key}
                      onClick={() => setUsageDays(r.key)}
                      className={`px-3 py-1 font-semibold rounded-md transition ${
                        usageDays === r.key ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500 hover:text-zinc-700"
                      }`}
                    >
                      {r.labelVi}
                    </button>
                  ))}
                </div>
                <Button variant="outline" size="sm" onClick={loadUsage} disabled={loadingUsage} className="bg-white">
                  <RefreshCw className={`w-3 h-3 mr-1 ${loadingUsage ? "animate-spin" : ""}`} /> Làm mới
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-6 space-y-8">
              {errorUsage ? (
                <ErrorState errorType={getAgentErrorType(errorUsage)} onRetry={loadUsage} />
              ) : loadingUsage ? (
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-pulse">
                  {[...Array(4)].map((_, i) => (
                    <div key={i} className="h-20 bg-zinc-50 rounded-xl" />
                  ))}
                </div>
              ) : (
                <div className="space-y-8">
                  {/* Stats bar */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 p-6 rounded-xl border border-zinc-150 bg-zinc-50/50">
                    <div className="flex flex-col">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Tổng requests</span>
                      <span className="text-2xl font-bold text-zinc-900 mt-1 tracking-tight">{fmtInt(usageTotals?.requests || 0)}</span>
                    </div>
                    <div className="flex flex-col lg:border-l lg:border-zinc-200 lg:pl-6">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Tổng token</span>
                      <span className="text-2xl font-bold text-zinc-900 mt-1 tracking-tight">{fmtTokens(usageTotals?.total_tokens || 0)}</span>
                      <span className="text-[10px] text-zinc-400 mt-1.5">vào {fmtTokens(usageTotals?.prompt_tokens || 0)} · ra {fmtTokens(usageTotals?.completion_tokens || 0)}</span>
                    </div>
                    <div className="flex flex-col lg:border-l lg:border-zinc-200 lg:pl-6">
                      <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Latency TB</span>
                      <span className="text-2xl font-bold text-zinc-900 mt-1 tracking-tight">{fmtInt(usageTotals?.avg_latency_ms || 0)} ms</span>
                    </div>
                    <div className="flex flex-col lg:border-l lg:border-zinc-200 lg:pl-6">
                      <span className="text-[10px] font-bold text-[#0144DB] uppercase tracking-wider">
                        Chi phí ({usageData?.currency})
                      </span>
                      <span className="text-2xl font-extrabold text-[#0144DB] mt-1 tracking-tight">{fmtCost(usageTotals?.cost_usd ?? null)}</span>
                      {usageTotals?.cost_usd === null && <span className="text-[10px] text-zinc-400 mt-1">chưa định giá</span>}
                    </div>
                  </div>

                  {/* Chart & Model usage */}
                  <div className="grid grid-cols-1 gap-6">
                    {/* Time series with integrated model breakdown */}
                    <div className="p-6 rounded-xl border border-zinc-200 bg-white flex flex-col justify-between shadow-xs">
                      <div>
                        <div className="flex items-center justify-between mb-4">
                          <h3 className="text-xs font-bold text-zinc-900">Mức độ hoạt động theo thời gian</h3>
                          <div className="flex gap-1 bg-zinc-100 p-0.5 rounded-lg text-xs">
                            {(["requests", "tokens"] as const).map((m) => (
                              <button
                                key={m}
                                onClick={() => setUsageMetric(m)}
                                className={`px-2.5 py-1 font-semibold rounded-md transition ${
                                  usageMetric === m ? "bg-white text-zinc-900 shadow-xs" : "text-zinc-500"
                                }`}
                              >
                                {m === "requests" ? "Requests" : "Tokens"}
                              </button>
                            ))}
                          </div>
                        </div>
                        <TimeSeriesChart
                          series={usageData?.series || []}
                          byModel={usageData?.by_model || []}
                          metric={usageMetric}
                        />
                      </div>

                      {/* Integrated Legend & Detail Grid */}
                      {usageData?.by_model.length ? (
                        <div className="mt-6 border-t border-zinc-100 pt-6">
                          <h4 className="text-xs font-bold text-zinc-900 mb-3">Phân bổ chi tiết theo Model</h4>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {usageData.by_model.map((m, i) => {
                              return (
                                <div key={m.model} className="p-3 rounded-xl border border-zinc-100 bg-zinc-50/30 flex flex-col justify-between gap-1">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PALETTE[i % PALETTE.length] }} />
                                    <span className="text-xs font-bold text-zinc-800 truncate" title={m.model}>{m.model}</span>
                                  </div>
                                  <div className="mt-2 flex items-center justify-between text-[11px]">
                                    <span className="text-zinc-500 font-mono">{fmtInt(m.requests)} reqs · {fmtTokens(m.total_tokens)} tkn</span>
                                    <span className="font-bold text-zinc-900">{m.priced ? fmtCost(m.cost_usd) : <span className="text-[9px] px-1 py-0.5 bg-zinc-100 text-zinc-400 rounded">Chưa định giá</span>}</span>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  </div>



                  <p className="text-[10px] text-zinc-400">
                    Khoảng: {usageData?.range.from?.slice(0, 10)} → {usageData?.range.to?.slice(0, 10)} · Dữ liệu từ bảng <code>llm_calls</code> của agent.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phân khu 3: Cấu hình hệ thống */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between border-b border-zinc-100 pb-4 flex-wrap gap-4">
              <CardTitle className="text-base font-bold text-zinc-900">
                Cấu hình hệ thống
              </CardTitle>
              <RoleGate allowedRoles={["superadmin"]}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleSaveSettings}
                  disabled={loadingSettings || savingSettings}
                  className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl"
                >
                  {savingSettings ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  {t("settingAgentBtnSave")}
                </Button>
              </RoleGate>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingSettings ? (
                <div className="space-y-4 animate-pulse">
                  <div className="h-20 bg-zinc-50 rounded-xl" />
                  <div className="h-20 bg-zinc-50 rounded-xl" />
                </div>
              ) : errorSettings ? (
                <ErrorState errorType={getAgentErrorType(errorSettings)} onRetry={loadSettings} />
              ) : (
                <div className="max-w-5xl">
                  {settingsData?.settingsRows.length ? (
                    <div className="divide-y divide-zinc-150">
                      {settingsData.settingsRows.map((row) => (
                        <div key={row.key} className="py-5 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-start gap-4">
                          <div className="md:w-1/4 min-w-0 shrink-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <code className="text-xs font-bold text-zinc-900 break-all">{row.key}</code>
                              <Badge variant={row.writable ? "success" : "secondary"}>
                                {row.writable ? "Writable" : "Readonly"}
                              </Badge>
                            </div>
                            <div className="mt-1 text-[10px] text-zinc-400 space-y-0.5">
                              <p>Cập nhật bởi: {row.updatedBy || "-"}</p>
                              <p>Lúc: {row.updatedAt ? format(row.updatedAt, "dd/MM/yyyy HH:mm") : "-"}</p>
                            </div>
                          </div>
                          <div className="flex-1 col-span-2">
                            {row.writable ? (
                              <Textarea
                                value={settingsValues[row.key] ?? ""}
                                onChange={(event) => setSettingsValues((prev) => ({ ...prev, [row.key]: event.target.value }))}
                                className="w-full min-h-[80px] rounded-xl bg-zinc-50 border border-zinc-200 focus:bg-white text-xs font-mono"
                              />
                            ) : (
                              <pre className="max-h-48 overflow-auto rounded-xl bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-650 font-mono border border-zinc-150">
                                {displayValue(row) || "-"}
                              </pre>
                            )}
                          </div>
                          {!row.writable && <Lock className="h-3.5 w-3.5 text-zinc-400 shrink-0 self-start md:self-auto mt-1" />}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="rounded-xl bg-zinc-50 border border-zinc-150 p-4 text-xs text-zinc-500">
                      {t("settingAgentNoSettings")}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Phân khu 4: Nhật ký hoạt động */}
          <Card>
            <CardHeader className="border-b border-zinc-100 pb-4">
              <CardTitle className="text-base font-bold text-zinc-900">
                Nhật ký hoạt động
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6">
              {loadingOverview ? (
                <div className="h-48 bg-zinc-50 rounded-xl animate-pulse" />
              ) : errorOverview ? (
                <p className="text-xs text-zinc-500">Không thể tải nhật ký hoạt động.</p>
              ) : (
                <div className="bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-xs">
                  <DataTable<AgentAuditLog>
                    columns={[
                      { key: "actor", header: t("auditThActor"), render: (row) => <span className="font-bold text-zinc-800">{row.actor}</span> },
                      {
                        key: "action",
                        header: t("auditThAction"),
                        render: (row) => (
                          <Badge variant={row.action.startsWith("update") ? "default" : "secondary"}>{row.action}</Badge>
                        ),
                      },
                      { key: "target", header: t("auditThTarget") },
                      {
                        key: "timestamp",
                        header: t("auditThTime"),
                        render: (row) => format(row.timestamp, "dd/MM/yyyy HH:mm:ss"),
                      },
                      {
                        key: "status",
                        header: t("runsThResult"),
                        align: "right",
                        render: (row) => (
                          <Badge variant={row.status === "success" ? "success" : "danger"}>
                            {row.status === "success" ? t("runsStatusSuccess") : t("runsStatusFailed")}
                          </Badge>
                        ),
                      },
                    ]}
                    data={auditLogs}
                    isLoading={false}
                    emptyText={t("dashNoAudit")}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
