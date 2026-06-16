"use client";

import * as React from "react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { apiFetch, getHttpErrorStatus } from "@/lib/api/client";
import {
  normalizeBotConnections,
  normalizeBotConnectionTestResult,
  type BotConnection,
  type BotPlatform,
} from "@/lib/api/bot-connections";
import { normalizeAgentConnections, type AgentConnection } from "@/lib/api/agent-connections";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { Bot, CheckCircle2, Edit2, Loader2, Plus, Zap, TestTube2, Trash2 } from "lucide-react";

const PLATFORMS: { value: BotPlatform; label: string }[] = [
  { value: "telegram", label: "Telegram" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "zalo", label: "Zalo" },
];

const TOKEN_HINT: Record<BotPlatform, string> = {
  telegram: "Bot token từ BotFather (vd: 123456:ABC-DEF...)",
  whatsapp: "Access token của WhatsApp Business API",
  zalo: "Access token của Zalo Official Account",
};

function platformLabel(value: BotPlatform) {
  return PLATFORMS.find((p) => p.value === value)?.label || value;
}

function slug(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 64);
}

export function BotConnectionPanel() {
  const t = useTranslation();
  const [bots, setBots] = React.useState<BotConnection[]>([]);
  const [agents, setAgents] = React.useState<AgentConnection[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [editing, setEditing] = React.useState<BotConnection | null>(null);
  const [isCreating, setIsCreating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [testingId, setTestingId] = React.useState<string | null>(null);

  const [botId, setBotId] = React.useState("");
  const [platform, setPlatform] = React.useState<BotPlatform>("telegram");
  const [name, setName] = React.useState("");
  const [token, setToken] = React.useState("");
  const [agentConnectionId, setAgentConnectionId] = React.useState("");
  const [enabled, setEnabled] = React.useState(true);

  const loadBots = React.useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      setBots(normalizeBotConnections(await apiFetch("/api/bot-connections")));
    } catch (err) {
      console.error(err);
      if (!silent) setError(err);
      toast.error(t("botMgmtLoadError"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  const loadAgents = React.useCallback(async () => {
    try {
      setAgents(normalizeAgentConnections(await apiFetch("/api/agent-connects")));
    } catch (err) {
      console.error(err);
    }
  }, []);

  React.useEffect(() => {
    loadBots();
    loadAgents();
  }, [loadBots, loadAgents]);

  const openCreate = () => {
    setEditing(null);
    setIsCreating(true);
    setBotId("");
    setPlatform("telegram");
    setName("");
    setToken("");
    setAgentConnectionId("");
    setEnabled(true);
  };

  const quickDeclareQueo = () => {
    setEditing(null);
    setIsCreating(true);
    setBotId("queo-telegram-bot");
    setPlatform("telegram");
    setName("Quéo Solution Agent");
    setToken("");
    setAgentConnectionId(agents.find((a) => a.id === "queo-solution-agent")?.id || agents[0]?.id || "");
    setEnabled(true);
  };

  const openEditor = (bot: BotConnection) => {
    setEditing(bot);
    setIsCreating(false);
    setBotId(bot.id);
    setPlatform(bot.platform);
    setName(bot.name);
    setToken("");
    setAgentConnectionId(bot.agentConnectionId || "");
    setEnabled(bot.enabled);
  };

  const closeModal = () => {
    setEditing(null);
    setIsCreating(false);
    setToken("");
  };

  const saveBot = async () => {
    if (saving) return;
    if (!name.trim()) {
      toast.error(t("botMgmtNameRequired"));
      return;
    }
    setSaving(true);
    const id = slug(botId || name);
    const body = {
      id,
      platform,
      name: name.trim(),
      token: token.trim() || undefined,
      agent_connection_id: agentConnectionId || undefined,
      enabled,
    };
    try {
      if (isCreating) {
        await apiFetch("/api/bot-connections", { method: "POST", body: JSON.stringify(body) });
      } else {
        await apiFetch(`/api/bot-connections/${editing?.id}`, { method: "PATCH", body: JSON.stringify(body) });
      }
      toast.success(t("botMgmtSaveSuccess"));
      closeModal();
      await loadBots(true);
    } catch (err) {
      console.error(err);
      toast.error(getHttpErrorStatus(err) === 409 ? t("botMgmtDuplicateId") : t("botMgmtSaveError"));
    } finally {
      setSaving(false);
    }
  };

  const testBot = async (bot: BotConnection) => {
    if (!bot.hasToken) {
      toast.error(t("botMgmtNoToken"));
      return;
    }
    setTestingId(bot.id);
    try {
      const result = normalizeBotConnectionTestResult(
        await apiFetch(`/api/bot-connections/${bot.id}/test`, { method: "POST" }),
      );
      if (result.skipped) {
        toast.info(t("botMgmtTestNotSupported").replace("{platform}", platformLabel(bot.platform)));
      } else if (result.status === "connected") {
        toast.success(result.botUsername ? t("botMgmtTestSuccessUser").replace("{username}", result.botUsername) : t("botMgmtTestSuccess"));
      } else {
        toast.error(result.error || t("botMgmtTestFailed"));
      }
      await loadBots(true);
    } catch (err) {
      console.error(err);
      toast.error(t("botMgmtTestError"));
    } finally {
      setTestingId(null);
    }
  };

  const deleteBot = async (bot: BotConnection) => {
    if (!confirm(t("botMgmtDeleteConfirm").replace("{name}", bot.name))) return;
    try {
      await apiFetch(`/api/bot-connections/${bot.id}`, { method: "DELETE" });
      toast.success(t("botMgmtDeleteSuccess"));
      await loadBots(true);
    } catch (err) {
      console.error(err);
      toast.error(t("botMgmtDeleteError"));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <RoleGate allowedRoles={["operator", "superadmin"]}>
          <Button variant="outline" size="sm" onClick={quickDeclareQueo} className="gap-1.5 rounded-xl font-bold">
            <Zap className="h-4 w-4 text-[#0144DB]" />
            {t("botMgmtBtnQuickDeclare")}
          </Button>
          <Button variant="primary" size="sm" onClick={openCreate} className="gap-1.5 rounded-xl font-bold">
            <Plus className="h-4 w-4" />
            {t("botMgmtBtnAdd")}
          </Button>
        </RoleGate>
      </div>

      {error ? (
        <ErrorState errorType="general" onRetry={() => loadBots()} />
      ) : (
        <DataTable<BotConnection>
          data={bots}
          isLoading={loading}
          emptyText={t("botMgmtEmpty")}
          columns={[
            {
              key: "name",
              header: "Bot",
              render: (row) => (
                <div className="min-w-[240px]">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-zinc-400" />
                    <span className="font-bold text-zinc-900">{row.name}</span>
                    {row.botUsername && <span className="text-xs text-zinc-500">@{row.botUsername}</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                    <code className="rounded bg-zinc-100 px-1.5 py-0.5">{row.id}</code>
                    {row.agentConnectionId && (
                      <span className="truncate">→ agent: {row.agentConnectionId}</span>
                    )}
                  </div>
                </div>
              ),
            },
            {
              key: "platform",
              header: t("botMgmtThPlatform"),
              render: (row) => <Badge variant="secondary">{platformLabel(row.platform)}</Badge>,
            },
            {
              key: "token",
              header: t("botMgmtThToken"),
              render: (row) => <Badge variant={row.hasToken ? "success" : "secondary"}>{row.hasToken ? t("botMgmtTokenSaved") : t("botMgmtTokenNone")}</Badge>,
            },
            {
              key: "status",
              header: t("botMgmtThStatus"),
              render: (row) => (
                <div className="space-y-1">
                  <Badge variant={row.status === "connected" ? "success" : row.status === "error" ? "danger" : "secondary"}>
                    {row.status}
                  </Badge>
                  {row.lastError && <p className="max-w-[280px] truncate text-xs text-zinc-500">{row.lastError}</p>}
                </div>
              ),
            },
            {
              key: "enabled",
              header: t("botMgmtThEnabled"),
              render: (row) => <Badge variant={row.enabled ? "success" : "secondary"}>{row.enabled ? "On" : "Off"}</Badge>,
            },
            {
              key: "actions",
              header: t("botMgmtThActions"),
              align: "right",
              render: (row) => (
                <div className="flex items-center justify-end gap-2">
                  <RoleGate allowedRoles={["operator", "superadmin"]}>
                    {row.platform === "telegram" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => testBot(row)}
                        disabled={testingId === row.id}
                        className="gap-1 rounded-xl"
                      >
                        {testingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <TestTube2 className="h-3.5 w-3.5" />}
                        Test
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEditor(row)} className="gap-1 rounded-xl">
                      <Edit2 className="h-3.5 w-3.5" />
                      {t("botMgmtBtnEdit")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteBot(row)} className="gap-1 rounded-xl text-red-600">
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
        title={isCreating ? t("botMgmtModalCreateTitle") : t("botMgmtModalEditTitle").replace("{name}", editing?.name || "")}
        size="xl"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={closeModal} disabled={saving} className="rounded-xl font-semibold">
              {t("botMgmtBtnCancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={saveBot} isLoading={saving} className="rounded-xl font-bold">
              <CheckCircle2 className="h-4 w-4" />
              {t("botMgmtBtnSave")}
            </Button>
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Field label={t("botMgmtLabelPlatform")} required>
            <select
              value={platform}
              onChange={(event) => setPlatform(event.target.value as BotPlatform)}
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
            >
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("botMgmtLabelBotId")} required>
            <Input
              value={botId}
              onChange={(event) => setBotId(slug(event.target.value))}
              disabled={!isCreating}
              placeholder={t("botMgmtPhBotId")}
              className="h-10 rounded-xl font-mono"
            />
          </Field>
          <Field label={t("botMgmtLabelBotName")} required>
            <Input value={name} onChange={(event) => setName(event.target.value)} className="h-10 rounded-xl md:col-span-2" />
          </Field>
          <Field label={t("botMgmtLabelToken")}>
            <Input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder={editing?.hasToken ? t("botMgmtPhTokenEdit") : (platform === "telegram" ? t("botMgmtTokenHintTelegram") : platform === "whatsapp" ? t("botMgmtTokenHintWhatsapp") : t("botMgmtTokenHintZalo"))}
              className="h-10 rounded-xl"
            />
          </Field>
          <Field label={t("botMgmtLabelAgent")}>
            <select
              value={agentConnectionId}
              onChange={(event) => setAgentConnectionId(event.target.value)}
              className="h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-sm font-semibold text-zinc-700"
            >
              <option value="">{t("botMgmtAgentNone")}</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} ({agent.id})
                </option>
              ))}
            </select>
          </Field>
          <label className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-700 md:col-span-2">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            {t("botMgmtLabelEnabled")}
          </label>
        </div>
      </Modal>
    </div>
  );
}
