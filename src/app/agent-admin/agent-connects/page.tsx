"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { apiFetch, getHttpErrorStatus } from "@/lib/api/client";
import { normalizeAgentConnections, normalizeAgentConnectionTestResult, type AgentConnection } from "@/lib/api/agent-connections";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { CheckCircle2, Edit2, Loader2, Plug, Plus, TestTube2, Trash2 } from "lucide-react";

const QUEO_ENDPOINT = "https://endpoint-427f02fb-7201-4fdc-b14a-2707dbbd78dd.agentbase-runtime.aiplatform.vngcloud.vn/";

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

export default function AgentConnectsPage() {
  const t = useTranslation();
  const [connections, setConnections] = React.useState<AgentConnection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [editing, setEditing] = React.useState<AgentConnection | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testOutput, setTestOutput] = React.useState<Record<string, string>>({});

  const [connectionId, setConnectionId] = React.useState("queo-solution-agent");
  const [name, setName] = React.useState("Quéo Solution Agent");
  const [baseUrl, setBaseUrl] = React.useState(QUEO_ENDPOINT);
  const [apiKey, setApiKey] = React.useState("");
  const [adminToken, setAdminToken] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);
  const [isDefault, setIsDefault] = React.useState(true);
  const { selectedId, setSelectedId, loadConnections: reloadConnectStore } = useAgentConnectStore();

  const loadConnections = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const next = normalizeAgentConnections(await apiFetch("/api/agent-connects"));
      setConnections(next);
      if (!selectedId) {
        const selected = next.find((item) => item.enabled && item.isDefault) || next.find((item) => item.enabled);
        if (selected) setSelectedId(selected.id);
      }
    } catch (err) {
      console.error(err);
      if (!silent) setError(err);
      toast.error(t("agentConnectLoadError"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t, selectedId, setSelectedId]);

  React.useEffect(() => {
    loadConnections();
  }, [loadConnections]);

  const resetForm = () => {
    setEditing(null);
    setIsCreating(true);
    setConnectionId("queo-solution-agent");
    setName("Quéo Solution Agent");
    setBaseUrl(QUEO_ENDPOINT);
    setApiKey("");
    setAdminToken("");
    setEnabled(true);
    setIsDefault(connections.length === 0);
  };

  const openEditor = (connection: AgentConnection) => {
    setEditing(connection);
    setIsCreating(false);
    setConnectionId(connection.id);
    setName(connection.name);
    setBaseUrl(connection.baseUrl);
    setApiKey("");
    setAdminToken("");
    setEnabled(connection.enabled);
    setIsDefault(connection.isDefault);
  };

  const closeModal = () => {
    setEditing(null);
    setIsCreating(false);
    setApiKey("");
    setAdminToken("");
  };

  const saveConnection = async () => {
    if (saving) return;
    setSaving(true);
    const id = slug(connectionId || name);
    const body = {
      id,
      name: name.trim(),
      base_url: baseUrl.trim(),
      api_key: apiKey.trim() || undefined,
      admin_token: adminToken.trim() || undefined,
      enabled,
      is_default: isDefault,
    };
    try {
      if (isCreating) {
        await apiFetch("/api/agent-connects", { method: "POST", body: JSON.stringify(body) });
      } else {
        await apiFetch(`/api/agent-connects/${connectionId}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      toast.success(t("agentConnectSaveSuccess"));
      closeModal();
      await loadConnections(true);
      await reloadConnectStore();
      if (enabled && (isDefault || !selectedId)) setSelectedId(id);
    } catch (err) {
      console.error(err);
      toast.error(getHttpErrorStatus(err) === 409 ? t("agentConnectDuplicateId") : t("agentConnectSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async (connection: AgentConnection) => {
    setTestingId(connection.id);
    try {
      const result = normalizeAgentConnectionTestResult(
        await apiFetch(`/api/agent-connects/${connection.id}/test`, { method: "POST" }),
      );
      const summary = [
        `health ${result.health.ok ? "OK" : result.health.error}`,
        result.admin.skipped ? "admin skipped" : `admin ${result.admin.ok ? "OK" : result.admin.error}`,
        result.invocation.skipped ? "invoke skipped" : `invoke ${result.invocation.ok ? "OK" : result.invocation.error}`,
      ].join(" · ");
      setTestOutput((prev) => ({ ...prev, [connection.id]: summary }));
      if (result.status === "connected") toast.success(t("agentConnectTestSuccess"));
      else toast.error(summary || t("agentConnectTestFailed"));
      await loadConnections(true);
      await reloadConnectStore();
    } catch (err) {
      console.error(err);
      toast.error(t("agentConnectTestError"));
    } finally {
      setTestingId(null);
    }
  };

  const deleteConnection = async (connection: AgentConnection) => {
    if (!confirm(`${t("agentConnectDeleteConfirm")} "${connection.name}"?`)) return;
    try {
      await apiFetch(`/api/agent-connects/${connection.id}`, { method: "DELETE" });
      toast.success(t("agentConnectDeleteSuccess"));
      await loadConnections(true);
      await reloadConnectStore();
    } catch (err) {
      console.error(err);
      toast.error(t("agentConnectDeleteError"));
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("agentConnectTitle")}
        subtitle={t("agentConnectSubtitle")}
        actions={
          <RoleGate allowedRoles={["operator", "superadmin"]}>
            <Button variant="primary" size="sm" onClick={resetForm} className="gap-1.5 rounded-xl font-bold">
              <Plus className="h-4 w-4" />
              {t("agentConnectAdd")}
            </Button>
          </RoleGate>
        }
      />

      {error ? (
        <ErrorState errorType="general" onRetry={() => loadConnections()} />
      ) : (
        <DataTable<AgentConnection>
          data={connections}
          isLoading={loading}
          emptyText={t("agentConnectEmpty")}
          columns={[
            {
              key: "name",
              header: t("agentConnectThAgent"),
              render: (row) => (
                <div className="min-w-[260px]">
                  <div className="flex items-center gap-2">
                    <Plug className="h-4 w-4 text-zinc-400" />
                    <span className="font-bold text-zinc-900">{row.name}</span>
                    {row.isDefault && <Badge variant="success">Default</Badge>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5">{row.id}</code>
                    <span className="max-w-[520px] truncate font-mono">{row.baseUrl}</span>
                  </div>
                </div>
              ),
            },
            {
              key: "status",
              header: t("agentConnectThStatus"),
              render: (row) => (
                <div className="space-y-1">
                  <Badge variant={row.status === "connected" ? "success" : row.status === "error" ? "danger" : "secondary"}>
                    {row.status}
                  </Badge>
                  {(testOutput[row.id] || row.lastError) && (
                    <p className="max-w-[360px] truncate text-xs text-zinc-500">{testOutput[row.id] || row.lastError}</p>
                  )}
                </div>
              ),
            },
            {
              key: "tokens",
              header: t("agentConnectThTokens"),
              render: (row) => (
                <div className="flex flex-wrap gap-1.5">
                  <Badge variant={row.hasAdminToken ? "success" : "secondary"}>admin</Badge>
                  <Badge variant={row.hasApiKey ? "success" : "secondary"}>invoke</Badge>
                </div>
              ),
            },
            {
              key: "enabled",
              header: t("agentConnectThEnabled"),
              render: (row) => (
                <Badge variant={row.enabled ? "success" : "secondary"}>
                  {row.enabled ? t("agentConnectStatusOn") : t("agentConnectStatusOff")}
                </Badge>
              ),
            },
            {
              key: "actions",
              header: t("agentConnectThActions"),
              align: "right",
              render: (row) => (
                <div className="flex items-center justify-end gap-2">
                  <RoleGate allowedRoles={["operator", "superadmin"]}>
                    <Button variant="ghost" size="sm" onClick={() => testConnection(row)} disabled={testingId === row.id} className="gap-1 rounded-xl">
                      {testingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
                      {t("agentConnectBtnTest")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEditor(row)} className="gap-1 rounded-xl">
                      <Edit2 className="h-3.5 w-3.5" />
                      {t("agentConnectBtnEdit")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteConnection(row)} className="gap-1 rounded-xl text-red-600">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </RoleGate>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal
        isOpen={isCreating || !!editing}
        onClose={closeModal}
        title={isCreating ? t("agentConnectModalCreate") : `${t("agentConnectModalEdit")} ${editing?.name || ""}`}
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeModal} disabled={saving} className="rounded-xl font-semibold">
              {t("skillsBtnCancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={saveConnection} isLoading={saving} className="rounded-xl font-bold">
              <CheckCircle2 className="h-4 w-4" />
              {t("save")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("agentConnectFieldId")} required>
            <Input value={connectionId} onChange={(event) => setConnectionId(slug(event.target.value))} disabled={!isCreating} className="h-10 rounded-xl font-mono" />
          </Field>
          <Field label={t("agentConnectFieldName")} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="h-10 rounded-xl" />
          </Field>
          <Field label={t("agentConnectFieldEndpoint")} required>
            <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="h-10 rounded-xl font-mono md:col-span-2" />
          </Field>
          <Field label={t("agentConnectFieldApiKey")}>
            <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder={editing?.hasApiKey ? t("agentConnectPhTokenEdit") : t("agentConnectPhApiKeyNew")} className="h-10 rounded-xl" />
          </Field>
          <Field label={t("agentConnectFieldAdminToken")}>
            <Input type="password" value={adminToken} onChange={(event) => setAdminToken(event.target.value)} placeholder={editing?.hasAdminToken ? t("agentConnectPhTokenEdit") : t("agentConnectPhAdminTokenNew")} className="h-10 rounded-xl" />
          </Field>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            {t("agentConnectFieldEnable")}
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
            <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
            {t("agentConnectFieldDefault")}
          </label>
        </div>
      </Modal>
    </PageShell>
  );
}
