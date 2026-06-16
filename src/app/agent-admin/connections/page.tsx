"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { apiFetch, getAgentErrorType, getHttpErrorStatus } from "@/lib/api/client";
import { normalizeMcpServers, normalizeMcpTestResult, type AgentMcpServer } from "@/lib/api/agent-admin";
import { toast } from "@/lib/store/toast-store";
import { CheckCircle2, Edit2, Loader2, Plug, Plus, TestTube2 } from "lucide-react";

const DEFAULT_ENV = `SERVER=https://atlas.vng.com.vn
SITE_NAME=
PAT_NAME=
AUTH=pat
PRODUCT_TELEMETRY_ENABLED=false
LOG_LEVEL=error`;

const DEFAULT_ARGS = "-y\n@tableau/mcp-server@latest";

function parseKeyValueLines(value: string) {
  return Object.fromEntries(
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const idx = line.indexOf("=");
        return idx === -1 ? [line, ""] : [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
      })
  );
}

function stringifyEnv(value: Record<string, string>) {
  return Object.entries(value)
    .map(([key, val]) => `${key}=${val}`)
    .join("\n");
}

function argsToText(args: string[]) {
  return args.join("\n");
}

function textToArgs(value: string) {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isTableauLocalServer(server: AgentMcpServer) {
  return server.id === "tableau-local" || server.name.toLowerCase().includes("tableau");
}

function isDirectHttpTestServer(server: AgentMcpServer) {
  return server.transport === "http" || isTableauLocalServer(server);
}

export default function ConnectionsPage() {
  const [servers, setServers] = React.useState<AgentMcpServer[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [editing, setEditing] = React.useState<AgentMcpServer | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);
  const [testOutput, setTestOutput] = React.useState<Record<string, string[]>>({});
  const [localTestStatus, setLocalTestStatus] = React.useState<Record<string, "connected" | "error">>({});

  const [serverId, setServerId] = React.useState("tableau-local");
  const [name, setName] = React.useState("Tableau MCP - Atlas");
  const [prefix, setPrefix] = React.useState("tableau");
  const [transport, setTransport] = React.useState<"stdio" | "http">("stdio");
  const [command, setCommand] = React.useState("npx");
  const [argsText, setArgsText] = React.useState(DEFAULT_ARGS);
  const [baseUrl, setBaseUrl] = React.useState("");
  const [envText, setEnvText] = React.useState(DEFAULT_ENV);
  const [enabled, setEnabled] = React.useState(false);
  const [secretKey, setSecretKey] = React.useState("PAT_VALUE");
  const [secretValue, setSecretValue] = React.useState("");

  const loadServers = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      setServers(normalizeMcpServers(await apiFetch("/api/agent-admin/mcp/servers")));
    } catch (err) {
      console.error(err);
      if (!silent) setError(err);
      toast.error("Không thể tải danh sách MCP connections.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadServers();
  }, [loadServers]);

  const resetForm = () => {
    setEditing(null);
    setIsCreating(true);
    setServerId("tableau-local");
    setName("Tableau MCP - Atlas");
    setPrefix("tableau");
    setTransport("stdio");
    setCommand("npx");
    setArgsText(DEFAULT_ARGS);
    setBaseUrl("");
    setEnvText(DEFAULT_ENV);
    setEnabled(false);
    setSecretKey("PAT_VALUE");
    setSecretValue("");
  };

  const openEditor = (server: AgentMcpServer) => {
    setEditing(server);
    setIsCreating(false);
    setServerId(server.id);
    setName(server.name);
    setPrefix(server.prefix);
    setTransport(server.transport);
    setCommand(server.command || "npx");
    setArgsText(argsToText(server.args.length ? server.args : textToArgs(DEFAULT_ARGS)));
    setBaseUrl(server.baseUrl);
    setEnvText(stringifyEnv(server.envPublic));
    setEnabled(server.enabled);
    setSecretKey(server.secretKeys.includes("PAT_VALUE") ? "PAT_VALUE" : server.secretKeys[0] || "PAT_VALUE");
    setSecretValue("");
  };

  const closeModal = () => {
    setEditing(null);
    setIsCreating(false);
    setSecretValue("");
  };

  const saveServer = async () => {
    if (saving) return;
    setSaving(true);
    const body = {
      server_id: serverId.trim(),
      name: name.trim(),
      prefix: prefix.trim(),
      transport,
      command: transport === "stdio" ? command.trim() : null,
      args: transport === "stdio" ? textToArgs(argsText) : [],
      base_url: transport === "http" ? baseUrl.trim() : null,
      env_public: parseKeyValueLines(envText),
      enabled,
    };
    try {
      if (isCreating) {
        await apiFetch("/api/agent-admin/mcp/servers", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch(`/api/agent-admin/mcp/servers/${serverId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      if (secretValue.trim()) {
        await apiFetch(`/api/agent-admin/mcp/servers/${serverId}/secret`, {
          method: "PUT",
          body: JSON.stringify({ secret_key: secretKey.trim(), value: secretValue }),
        });
      }
      toast.success("Đã lưu MCP connection.");
      closeModal();
      loadServers(true);
    } catch (err) {
      console.error(err);
      toast.error(getHttpErrorStatus(err) === 409 ? "Connection bị trùng ID hoặc prefix." : "Không thể lưu MCP connection.");
    } finally {
      setSaving(false);
    }
  };

  const toggleServer = async (server: AgentMcpServer) => {
    try {
      await apiFetch(`/api/agent-admin/mcp/servers/${server.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !server.enabled }),
      });
      loadServers(true);
    } catch (err) {
      console.error(err);
      toast.error("Không thể thay đổi trạng thái connection.");
    }
  };

  const testServer = async (server: AgentMcpServer) => {
    setTestingId(server.id);
    try {
      if (isTableauLocalServer(server)) {
        const result = await apiFetch("/api/workflows/mcp-fetch", {
          method: "POST",
          body: JSON.stringify({
            mcpConnectionId: server.id,
            tool: "list-views",
            arguments: { limit: 5 },
          }),
        }) as { ok?: boolean; result?: string; error?: string };

        if (!result.ok) {
          setLocalTestStatus((prev) => ({ ...prev, [server.id]: "error" }));
          toast.error(result.error || "Didi local Tableau MCP test thất bại.");
          return;
        }

        let viewNames: string[] = [];
        try {
          const parsed = JSON.parse(result.result || "[]");
          viewNames = (Array.isArray(parsed) ? parsed : [])
            .map((view) => typeof view?.name === "string" ? view.name : "")
            .filter(Boolean)
            .slice(0, 5);
        } catch {
          viewNames = ["list-views"];
        }

        setLocalTestStatus((prev) => ({ ...prev, [server.id]: "connected" }));
        setTestOutput((prev) => ({ ...prev, [server.id]: viewNames }));
        toast.success(`Didi local bridge kết nối thành công, đọc được ${viewNames.length || "nhiều"} views.`);
        return;
      }

      if (server.transport === "http") {
        const result = await apiFetch("/api/workflows/mcp-fetch", {
          method: "POST",
          body: JSON.stringify({
            mcpConnectionId: server.id,
            tool: "__tools/list",
          }),
        }) as { ok?: boolean; endpoint?: string; toolCount?: number; tools?: string[]; error?: string };

        if (!result.ok) {
          setLocalTestStatus((prev) => ({ ...prev, [server.id]: "error" }));
          toast.error(result.error || "Didi HTTP MCP test thất bại.");
          return;
        }

        setLocalTestStatus((prev) => ({ ...prev, [server.id]: "connected" }));
        setTestOutput((prev) => ({ ...prev, [server.id]: (result.tools || []).slice(0, 8) }));
        toast.success(`Didi HTTP MCP kết nối thành công, tìm thấy ${result.toolCount || 0} tools.`);
        return;
      }

      const result = normalizeMcpTestResult(
        await apiFetch(`/api/agent-admin/mcp/servers/${server.id}/test`, { method: "POST" })
      );
      if (result.status === "connected") {
        setTestOutput((prev) => ({ ...prev, [server.id]: result.tools }));
        toast.success(`Kết nối thành công, tìm thấy ${result.toolCount} tools.`);
      } else {
        toast.error(result.error || "Test connection thất bại.");
      }
      loadServers(true);
    } catch (err) {
      console.error(err);
      if (isDirectHttpTestServer(server)) {
        setLocalTestStatus((prev) => ({ ...prev, [server.id]: "error" }));
      }
      toast.error("Không thể test MCP connection.");
    } finally {
      setTestingId(null);
    }
  };

  const errorStatus = getHttpErrorStatus(error);
  const mcpRouteMissing = errorStatus === 404;

  return (
    <PageShell>
      <PageHeader
        title="Connect MCP"
        subtitle="Cấu hình, bật/tắt và kiểm thử nhiều MCP connectors dùng chung cho Workflow Configure, Atlas và Agent runtime."
        actions={
          <RoleGate allowedRoles={["operator", "superadmin"]}>
            <Button variant="primary" size="sm" onClick={resetForm} className="gap-1.5 rounded-xl font-bold">
              <Plus className="h-4 w-4" />
              Thêm connection
            </Button>
          </RoleGate>
        }
      />

      {error ? (
        <ErrorState
          errorType={mcpRouteMissing ? "general" : getAgentErrorType(error)}
          title={mcpRouteMissing ? "Agent chưa có MCP routes" : undefined}
          description={
            mcpRouteMissing
              ? "Production Agent đang hoạt động nhưng chưa deploy module MCP. Cần cập nhật Quéo Agent trước khi cấu hình Connections."
              : undefined
          }
          onRetry={() => loadServers()}
        />
      ) : (
        <DataTable<AgentMcpServer>
          data={servers}
          isLoading={loading}
          emptyText="Chưa có MCP connection nào."
          columns={[
            {
              key: "name",
              header: "Connection",
              render: (row) => (
                <div className="min-w-[220px]">
                  <div className="flex items-center gap-2">
                    <Plug className="h-4 w-4 text-zinc-400" />
                    <span className="font-bold text-zinc-900">{row.name}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5">{row.id}</code>
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5">{row.prefix}__*</code>
                  </div>
                </div>
              ),
            },
            {
              key: "transport",
              header: "Transport",
              render: (row) => <Badge variant="outline">{row.transport}</Badge>,
            },
            {
              key: "status",
              header: "Status",
              render: (row) => {
                const isTableauLocal = isTableauLocalServer(row);
                const didiLocalStatus = localTestStatus[row.id];
                return (
                  <div className="space-y-1">
                    {isTableauLocal ? (
                      <>
                        <Badge variant={didiLocalStatus === "connected" ? "success" : didiLocalStatus === "error" ? "danger" : "secondary"}>
                          Didi local: {didiLocalStatus || "chưa test"}
                        </Badge>
                        <Badge variant="outline">remote agent: {row.status}</Badge>
                        <p className="max-w-[260px] text-xs text-zinc-500">
                          Workflow Atlas dùng Didi local bridge, bấm Test để kiểm tra đường chạy thực tế.
                        </p>
                      </>
                    ) : (
                      <Badge variant={row.status === "connected" ? "success" : row.status === "error" ? "danger" : "secondary"}>
                        {row.status}
                      </Badge>
                    )}
                    {!isTableauLocal && row.transport === "http" && (
                      <>
                        {localTestStatus[row.id] && (
                          <Badge variant={localTestStatus[row.id] === "connected" ? "success" : "danger"}>
                            Didi direct: {localTestStatus[row.id]}
                          </Badge>
                        )}
                        <p className="max-w-[260px] text-xs text-zinc-500">
                          Bấm Test để Didi kiểm tra trực tiếp HTTP MCP endpoint.
                        </p>
                      </>
                    )}
                    {row.lastError && !isTableauLocal && <p className="max-w-[260px] truncate text-xs text-red-600">{row.lastError}</p>}
                  </div>
                );
              },
            },
            {
              key: "toolCount",
              header: "Tools",
              render: (row) => (
                <div>
                  <span className="font-bold text-zinc-900">{row.toolCount}</span>
                  {testOutput[row.id]?.length ? (
                    <p className="mt-1 max-w-[260px] truncate text-xs text-zinc-500">{testOutput[row.id].slice(0, 4).join(", ")}</p>
                  ) : null}
                </div>
              ),
            },
            {
              key: "enabled",
              header: "Enabled",
              render: (row) => (
                <div className="flex items-center gap-2">
                  <Badge variant={row.enabled ? "success" : "secondary"}>{row.enabled ? "On" : "Off"}</Badge>
                  <RoleGate allowedRoles={["operator", "superadmin"]}>
                    <button
                      onClick={() => toggleServer(row)}
                      className={`relative h-5 w-9 rounded-full transition-colors ${row.enabled ? "bg-green-500" : "bg-zinc-200"}`}
                    >
                      <span className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${row.enabled ? "translate-x-4" : ""}`} />
                    </button>
                  </RoleGate>
                </div>
              ),
            },
            {
              key: "actions",
              header: "Actions",
              align: "right",
              render: (row) => (
                <div className="flex items-center justify-end gap-2">
                  <RoleGate allowedRoles={["operator", "superadmin"]}>
                    <Button variant="ghost" size="sm" onClick={() => testServer(row)} disabled={testingId === row.id} className="gap-1 rounded-xl">
                      {testingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
                      Test
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEditor(row)} className="gap-1 rounded-xl">
                      <Edit2 className="h-3.5 w-3.5" />
                      Sửa
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
        title={isCreating ? "Thêm MCP connection" : `Cấu hình ${editing?.name || ""}`}
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeModal} disabled={saving} className="rounded-xl font-semibold">
              Hủy
            </Button>
            <Button variant="primary" size="sm" onClick={saveServer} isLoading={saving} className="rounded-xl font-bold">
              <CheckCircle2 className="h-4 w-4" />
              Lưu
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Server ID" required>
            <Input value={serverId} onChange={(event) => setServerId(event.target.value)} disabled={!isCreating} className="h-10 rounded-xl font-mono" />
          </Field>
          <Field label="Tên connection" required>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="h-10 rounded-xl" />
          </Field>
          <Field label="Tool prefix" required>
            <Input value={prefix} onChange={(event) => setPrefix(event.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} className="h-10 rounded-xl font-mono" />
          </Field>
          <Field label="Transport" required>
            <Select
              value={transport}
              onChange={(event) => setTransport(event.target.value === "http" ? "http" : "stdio")}
              options={[
                { value: "stdio", label: "stdio" },
                { value: "http", label: "http" },
              ]}
              className="h-10 rounded-xl"
            />
          </Field>
          {transport === "stdio" ? (
            <>
              <Field label="Command" required>
                <Input value={command} onChange={(event) => setCommand(event.target.value)} className="h-10 rounded-xl font-mono" />
              </Field>
              <Field label="Args">
                <Textarea value={argsText} onChange={(event) => setArgsText(event.target.value)} className="min-h-[104px] rounded-xl font-mono text-xs" />
              </Field>
            </>
          ) : (
            <Field label="Base URL" required>
              <Input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="h-10 rounded-xl font-mono" />
            </Field>
          )}
          <Field label="Env public">
            <Textarea value={envText} onChange={(event) => setEnvText(event.target.value)} className="min-h-[156px] rounded-xl font-mono text-xs" />
          </Field>
          <div className="space-y-4">
            <Field label="Secret key">
              <Input value={secretKey} onChange={(event) => setSecretKey(event.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))} className="h-10 rounded-xl font-mono" />
            </Field>
            <Field label="Secret value">
              <Input type="password" value={secretValue} onChange={(event) => setSecretValue(event.target.value)} placeholder={editing?.secretKeys.length ? "Để trống nếu không đổi" : "Nhập token"} className="h-10 rounded-xl" />
            </Field>
            <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700">
              <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
              Enable connection
            </label>
          </div>
        </div>
      </Modal>
    </PageShell>
  );
}
