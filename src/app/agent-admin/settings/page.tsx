"use client";

import * as React from "react";
import { format } from "date-fns";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { Button } from "@/components/ui/button";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import {
  normalizeAccessUsers,
  normalizeMcpServers,
  normalizeSettings,
  normalizeStatus,
  type AgentAccessUser,
  type AgentMcpServer,
  type AgentSettingRow,
  type AgentSettings,
  type AgentStatusData,
} from "@/lib/api/agent-admin";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { Activity, Database, KeyRound, Loader2, Lock, PlugZap, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";

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
  if (key === "model_routing") {
    return JSON.parse(trimmed);
  }
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

export default function SettingsPage() {
  const t = useTranslation();
  const [settings, setSettings] = React.useState<AgentSettings | null>(null);
  const [status, setStatus] = React.useState<AgentStatusData | null>(null);
  const [mcpServers, setMcpServers] = React.useState<AgentMcpServer[]>([]);
  const [accessUsers, setAccessUsers] = React.useState<AgentAccessUser[]>([]);
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [initialValues, setInitialValues] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const loadSettings = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [settingsPayload, statusPayload, mcpPayload, accessPayload] = await Promise.all([
        apiFetch("/api/agent-admin/settings"),
        apiFetch("/api/agent-admin/status"),
        apiFetch("/api/agent-admin/mcp/servers"),
        apiFetch("/api/agent-admin/access"),
      ]);
      const data = normalizeSettings(settingsPayload);
      const nextValues = settingsToValues(data.settingsRows);

      setSettings(data);
      setStatus(normalizeStatus(statusPayload));
      setMcpServers(normalizeMcpServers(mcpPayload));
      setAccessUsers(normalizeAccessUsers(accessPayload));
      setValues(nextValues);
      setInitialValues(nextValues);
    } catch (err) {
      console.error(err);
      setError(err);
      toast.error(t("settingAgentLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const handleSave = async () => {
    if (saving || !settings) return;
    setSaving(true);
    try {
      const changed: Record<string, unknown> = {};

      for (const row of settings.settingsRows) {
        if (!row.writable) continue;
        const nextValue = values[row.key] ?? "";
        if (nextValue === initialValues[row.key]) continue;
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
      setSaving(false);
    }
  };

  const writableRows = settings?.settingsRows.filter((row) => row.writable) ?? [];
  const readOnlyRows = settings?.settingsRows.filter((row) => !row.writable) ?? [];
  const registryVersion = values.registry_version || "-";
  const workflowEnabled = values.workflow_enabled === "1" ? t("settingAgentEnabled") : t("settingAgentDisabled");
  const connectedMcpCount = mcpServers.filter((server) => server.status === "connected").length;
  const approvedAccessCount = accessUsers.filter((user) => user.status === "approved").length;

  const renderRow = (row: AgentSettingRow) => (
    <div key={row.key} className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <code className="text-sm font-bold text-zinc-900">{row.key}</code>
            <Badge variant={row.writable ? "success" : "secondary"}>
              {row.writable ? t("settingAgentWritable") : t("settingAgentReadonly")}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
            <span>{t("settingAgentUpdatedBy")}: {row.updatedBy || "-"}</span>
            <span>
              {t("settingAgentUpdatedAt")}: {row.updatedAt ? format(row.updatedAt, "dd/MM/yyyy HH:mm") : "-"}
            </span>
          </div>
        </div>
        {!row.writable && <Lock className="h-4 w-4 text-zinc-400" />}
      </div>

      {row.writable ? (
        <Textarea
          value={values[row.key] ?? ""}
          onChange={(event) => setValues((prev) => ({ ...prev, [row.key]: event.target.value }))}
          className="mt-4 min-h-[96px] rounded-xl bg-zinc-50 font-mono text-xs"
        />
      ) : (
        <pre className="mt-4 max-h-56 overflow-auto rounded-xl bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-700">
          {displayValue(row) || "-"}
        </pre>
      )}
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        title={t("settingAgentTitle")}
        subtitle={t("settingAgentSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentConnectSelect onChange={() => loadSettings()} />
            <RoleGate allowedRoles={["superadmin"]}>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={loading || saving}
                className="flex items-center gap-2 font-bold cursor-pointer rounded-xl"
              >
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                {t("settingAgentBtnSave")}
              </Button>
            </RoleGate>
          </div>
        }
      />

      {loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-32 rounded-2xl bg-zinc-200" />
          <div className="h-32 rounded-2xl bg-zinc-200" />
          <div className="h-32 rounded-2xl bg-zinc-200" />
        </div>
      ) : error ? (
        <ErrorState errorType={getAgentErrorType(error)} onRetry={loadSettings} />
      ) : (
        <div className="max-w-5xl space-y-8">
          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
              <Activity className="h-4 w-4 text-[--color-primary]" />
              {t("settingAgentRuntimeTitle")}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <Activity className="h-4 w-4" />
                  {t("settingAgentCardAgent")}
                </div>
                <p className="mt-2 text-xl font-extrabold text-zinc-900">{status?.appVersion || "N/A"}</p>
                <p className="mt-1 text-xs text-zinc-500">{status?.activeModel || "Agent runtime"}</p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <Database className="h-4 w-4" />
                  {t("settingAgentCardKnowledge")}
                </div>
                <p className="mt-2 text-xl font-extrabold text-zinc-900">
                  {status?.kbAvailable ? status.kbVersion || t("dashKbAvailable") : t("dashKbUnavailable")}
                </p>
                <p className="mt-1 text-xs text-zinc-500">
                  {status?.skillsCount ?? 0} skills / {status?.workflowsCount ?? 0} workflows
                </p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <SlidersHorizontal className="h-4 w-4" />
                  {t("settingAgentCardRegistry")}
                </div>
                <p className="mt-2 text-xl font-extrabold text-zinc-900">{registryVersion}</p>
                <p className="mt-1 text-xs text-zinc-500">workflow_enabled: {workflowEnabled}</p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <PlugZap className="h-4 w-4" />
                  {t("settingAgentCardMcp")}
                </div>
                <p className="mt-2 text-xl font-extrabold text-zinc-900">{connectedMcpCount}/{mcpServers.length}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("dashMcpServers")}</p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <ShieldCheck className="h-4 w-4" />
                  {t("settingAgentCardAccess")}
                </div>
                <p className="mt-2 text-xl font-extrabold text-zinc-900">{approvedAccessCount}/{accessUsers.length}</p>
                <p className="mt-1 text-xs text-zinc-500">{t("accessStatusApproved")}</p>
              </div>
              <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  <KeyRound className="h-4 w-4" />
                  {t("settingAgentReturnedKeys")}
                </div>
                <p className="mt-2 text-xl font-extrabold text-zinc-900">{settings?.settingsRows.length ?? 0}</p>
                <p className="mt-1 text-xs text-zinc-500">/admin/api/settings</p>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <h3 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
              <SlidersHorizontal className="h-4 w-4 text-[--color-primary]" />
              {t("settingAgentSettingsTitle")}
            </h3>
            {settings?.settingsRows.length ? (
              <div className="space-y-4">
                {writableRows.map(renderRow)}
                {readOnlyRows.map(renderRow)}
              </div>
            ) : (
              <p className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-500">
                {t("settingAgentNoSettings")}
              </p>
            )}
          </section>
        </div>
      )}
    </PageShell>
  );
}
