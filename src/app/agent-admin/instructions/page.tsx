"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { Button } from "@/components/ui/button";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { Save, Loader2 } from "lucide-react";

function readInstructions(data: unknown) {
  if (typeof data !== "object" || data === null) return "";
  const record = data as Record<string, unknown>;
  
  if (typeof record.content === "string") return record.content;
  if (typeof record.active_content === "string") return record.active_content;
  if (typeof record.instructions === "string") return record.instructions;
  
  if (Array.isArray(record.instructions)) {
    const instructions = record.instructions as Array<{ active?: boolean | number; content?: unknown }>;
    const active = instructions.find((item) => item && (item.active === 1 || item.active === true));
    if (active && typeof active.content === "string") {
      return active.content;
    }
    const first = instructions[0];
    if (first && typeof first.content === "string") {
      return first.content;
    }
  }
  
  return "";
}

export default function InstructionsPage() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();
  const [instructions, setInstructions] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<unknown>(null);

  const loadInstructions = React.useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      setInstructions(readInstructions(await apiFetch("/api/agent-admin/instructions")));
    } catch (err) {
      console.error(err);
      setError(err);
      toast.error(t("instLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t, selectedId]);

  React.useEffect(() => {
    if (selectedId) {
      loadInstructions();
    } else {
      setInstructions("");
      setLoading(false);
    }
  }, [selectedId, loadInstructions]);

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await apiFetch("/api/agent-admin/instructions", {
        method: "POST",
        body: JSON.stringify({ name: "persona", content: instructions, instructions }),
      });
      toast.success(t("instSaveSuccess"));
    } catch (err) {
      console.error(err);
      toast.error(t("instSaveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("instTitle")}
        subtitle={t("instSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentConnectSelect />
            <RoleGate allowedRoles={["operator", "superadmin"]}>
              <Button
                variant="primary"
                onClick={handleSave}
                disabled={loading || saving}
                className="flex items-center gap-2 font-bold cursor-pointer rounded-xl"
              >
                {saving ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                {t("instSaveBtn")}
              </Button>
            </RoleGate>
          </div>
        }
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">{t("agentConnectSelectAgent")}</p>
        </div>
      ) : loading ? (
        <div className="space-y-4 animate-pulse">
          <div className="h-10 bg-zinc-200 rounded-xl w-1/4"></div>
          <div className="h-96 bg-zinc-200 rounded-2xl"></div>
        </div>
      ) : error ? (
        <ErrorState errorType={getAgentErrorType(error)} onRetry={loadInstructions} />
      ) : (
        <div className="space-y-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-sm p-6 space-y-4">
            <h3 className="text-sm font-bold text-zinc-800">{t("instEditorTitle")}</h3>
            <MarkdownEditor
              value={instructions}
              onChange={(val) => setInstructions(val || "")}
              height={600}
              preview="live"
            />
          </div>
        </div>
      )}
    </PageShell>
  );
}
