"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MarkdownEditor } from "@/components/ui/markdown-editor";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType, getHttpErrorStatus } from "@/lib/api/client";
import { normalizeWorkflows, type AgentWorkflow } from "@/lib/api/agent-admin";
import { parseMarkdownMetadata, slugFromText } from "@/lib/agent-admin/markdown-upload";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { Play, Edit2, Loader2, Plus, Upload } from "lucide-react";
import { format } from "date-fns";

export default function WorkflowsPage() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();
  const [workflows, setWorkflows] = React.useState<AgentWorkflow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);

  // Editor states
  const [selectedWorkflow, setSelectedWorkflow] = React.useState<AgentWorkflow | null>(null);
  const [editorMode, setEditorMode] = React.useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = React.useState("");
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editAlias, setEditAlias] = React.useState("");
  const [editCron, setEditCron] = React.useState("");
  const [editInstructions, setEditInstructions] = React.useState("");
  const [editEnabled, setEditEnabled] = React.useState(true);
  const [editShowInMenu, setEditShowInMenu] = React.useState(true);
  const [saving, setSaving] = React.useState(false);

  // Trigger state
  const [triggeringId, setTriggeringId] = React.useState<string | null>(null);
  const [uploading, setUploading] = React.useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);

  const resetEditor = () => {
    setSelectedWorkflow(null);
    setEditorMode(null);
    setEditId("");
    setEditName("");
    setEditDescription("");
    setEditAlias("");
    setEditCron("");
    setEditInstructions("");
    setEditEnabled(true);
    setEditShowInMenu(true);
  };

  const handleCreateWorkflow = () => {
    setSelectedWorkflow(null);
    setEditorMode("create");
    setEditId("");
    setEditName("");
    setEditDescription("");
    setEditAlias("");
    setEditCron("");
    setEditInstructions("---\nname: \ndescription: \nschedule: \"\"\n---\n\n# Workflow Instructions\n");
    setEditEnabled(true);
    setEditShowInMenu(true);
  };

  const loadWorkflows = React.useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      setWorkflows(normalizeWorkflows(await apiFetch("/api/agent-admin/workflows")));
    } catch (err) {
      console.error(err);
      setError(err);
      toast.error(t("wfAdminLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t, selectedId]);

  React.useEffect(() => {
    if (selectedId) {
      loadWorkflows();
    } else {
      setWorkflows([]);
      setLoading(false);
    }
  }, [selectedId, loadWorkflows]);

  const handleToggleEnable = async (wf: AgentWorkflow) => {
    const nextStatus = !wf.enabled;
    try {
      await apiFetch(`/api/agent-admin/workflows/${wf.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextStatus }),
      });
      toast.success(nextStatus ? t("wfAdminToggleSuccessActive") : t("wfAdminToggleSuccessInactive"));
      setWorkflows((prev) =>
        prev.map((w) => (w.id === wf.id ? { ...w, enabled: nextStatus } : w))
      );
    } catch (err) {
      console.error(err);
      toast.error(t("wfAdminToggleError"));
    }
  };

  const handleTriggerRun = async (wf: AgentWorkflow) => {
    if (triggeringId) return;
    setTriggeringId(wf.id);
    try {
      await apiFetch(`/api/agent-admin/workflows/${wf.id}/run`, {
        method: "POST",
      });
      toast.success(t("wfAdminTriggerSuccess"));
      loadWorkflows();
    } catch (err) {
      console.error(err);
      toast.error(t("wfAdminTriggerError"));
    } finally {
      setTriggeringId(null);
    }
  };

  const handleOpenEditor = (wf: AgentWorkflow) => {
    setSelectedWorkflow(wf);
    setEditorMode("edit");
    setEditId(wf.id);
    setEditName(wf.name);
    setEditDescription(wf.description);
    setEditAlias(wf.commandAlias || "");
    setEditCron(wf.cronSchedule || "");
    setEditInstructions(wf.instructions || "");
    setEditEnabled(wf.enabled);
    setEditShowInMenu(wf.showInMenu);
  };

  const handleSaveWorkflow = async () => {
    if (!editorMode || saving) return;
    setSaving(true);
    const normalizedId = slugFromText(editId || editName);
    const alias = editAlias.trim() || normalizedId.replace(/-/g, "_").slice(0, 32);
    const body = {
      name: editName.trim(),
      description: editDescription.trim(),
      content_override: editInstructions,
      schedule: editCron.trim() || null,
      enabled: editEnabled,
      command_alias: alias,
      show_in_menu: editShowInMenu,
    };
    try {
      if (editorMode === "create") {
        await apiFetch("/api/agent-admin/workflows", {
          method: "POST",
          body: JSON.stringify({ ...body, workflow_id: normalizedId }),
        });
      } else if (selectedWorkflow) {
        await apiFetch(`/api/agent-admin/workflows/${selectedWorkflow.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      toast.success(editorMode === "create" ? "Đã thêm workflow." : t("wfAdminUpdateCronSuccess"));
      resetEditor();
      loadWorkflows();
    } catch (err) {
      console.error(err);
      toast.error(getHttpErrorStatus(err) === 409 ? "Workflow bị trùng ID hoặc command alias." : t("wfAdminUpdateCronError"));
    } finally {
      setSaving(false);
    }
  };

  const handleUploadWorkflow = async (file: File | null) => {
    if (!file || uploading) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      toast.error("Vui lòng chọn file .md.");
      return;
    }
    setUploading(true);
    try {
      const content = await file.text();
      const meta = parseMarkdownMetadata(content, file.name);
      const body = {
        workflow_id: meta.id,
        name: meta.name,
        description: meta.description || meta.name,
        content_override: content,
        schedule: meta.schedule || null,
        enabled: true,
        command_alias: meta.id.replace(/-/g, "_").slice(0, 32),
        show_in_menu: true,
      };
      try {
        await apiFetch("/api/agent-admin/workflows", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (getHttpErrorStatus(err) !== 409) throw err;
        await apiFetch(`/api/agent-admin/workflows/${meta.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: body.name,
            description: body.description,
            content_override: content,
            schedule: body.schedule,
          }),
        });
      }
      toast.success(`Đã upload workflow ${meta.name}.`);
      loadWorkflows();
    } catch (err) {
      console.error(err);
      toast.error("Không thể upload workflow .md.");
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("wfAdminTitle")}
        subtitle={t("wfAdminSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentConnectSelect />
            <RoleGate allowedRoles={["operator", "superadmin"]}>
              <div className="flex items-center gap-2">
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept=".md,text/markdown,text/plain"
                  className="hidden"
                  onChange={(event) => handleUploadWorkflow(event.target.files?.[0] || null)}
                />
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleCreateWorkflow}
                  className="flex items-center gap-1.5 rounded-xl font-bold"
                >
                  <Plus className="h-4 w-4" />
                  Thêm workflow
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => uploadInputRef.current?.click()}
                  isLoading={uploading}
                  className="flex items-center gap-1.5 rounded-xl font-bold"
                >
                  <Upload className="h-4 w-4" />
                  Upload .md
                </Button>
              </div>
            </RoleGate>
          </div>
        }
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">Chọn Agent Connect để xem dữ liệu.</p>
        </div>
      ) : error ? (
        <ErrorState errorType={getAgentErrorType(error)} onRetry={loadWorkflows} />
      ) : (
      <DataTable<AgentWorkflow>
        columns={[
          {
            key: "name",
            header: t("wfAdminThName"),
            render: (row) => (
              <div>
                <span className="font-bold text-zinc-900">{row.name}</span>
                <p className="text-xs text-zinc-500 mt-0.5">{row.description}</p>
              </div>
            ),
          },
          {
            key: "cronSchedule",
            header: t("wfAdminThCron"),
            render: (row) => (
              <span className="text-xs font-mono font-bold bg-zinc-100 border border-zinc-200 px-2 py-1 rounded text-zinc-700">
                {row.cronSchedule}
              </span>
            ),
          },
          {
            key: "lastRunAt",
            header: t("wfAdminThLastRun"),
            render: (row) => (
              <div className="space-y-0.5">
                <div className="text-xs text-zinc-800">
                  {row.lastRunAt ? format(row.lastRunAt, "dd/MM/yyyy HH:mm") : t("wfAdminLastRunNever")}
                </div>
                {row.lastRunStatus && (
                  <Badge
                    variant={
                      row.lastRunStatus === "success"
                        ? "success"
                        : row.lastRunStatus === "failure"
                        ? "danger"
                        : "warning"
                    }
                  >
                    {row.lastRunStatus === "success"
                      ? t("wfAdminStatusSuccess")
                      : row.lastRunStatus === "failure"
                      ? t("wfAdminStatusFailed")
                      : t("wfAdminStatusRunning")}
                  </Badge>
                )}
              </div>
            ),
          },
          {
            key: "enabled",
            header: t("wfAdminThSchedule"),
            render: (row) => (
              <div className="flex items-center gap-2">
                <Badge variant={row.enabled ? "success" : "secondary"}>
                  {row.enabled ? t("wfAdminStatusOn") : t("wfAdminStatusOff")}
                </Badge>
                <RoleGate allowedRoles={["operator", "superadmin"]}>
                  <button
                    onClick={() => handleToggleEnable(row)}
                    className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                      row.enabled ? "bg-green-500" : "bg-zinc-200"
                    }`}
                  >
                    <div
                      className={`absolute top-0.5 left-0.5 bg-white w-4 h-4 rounded-full transition-transform ${
                        row.enabled ? "translate-x-4" : "translate-x-0"
                      }`}
                    />
                  </button>
                </RoleGate>
              </div>
            ),
          },
          {
            key: "actions",
            header: t("wfAdminThActions"),
            align: "right",
            render: (row) => (
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenEditor(row)}
                  className="flex items-center gap-1.5 cursor-pointer rounded-xl"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  {t("wfAdminBtnEdit")}
                </Button>
                <RoleGate allowedRoles={["operator", "superadmin"]}>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleTriggerRun(row)}
                    disabled={triggeringId === row.id || row.lastRunStatus === "running"}
                    className="flex items-center gap-1.5 cursor-pointer rounded-xl bg-emerald-600 hover:bg-emerald-700 border-none text-white font-bold"
                  >
                    {triggeringId === row.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current" />
                    )}
                    {t("wfAdminBtnRun")}
                  </Button>
                </RoleGate>
              </div>
            ),
          },
        ]}
        data={workflows}
        isLoading={loading}
        emptyText={t("wfAdminEmpty")}
      />
      )}

      {/* Workflow Editor Modal */}
      <Modal
        isOpen={!!editorMode}
        onClose={resetEditor}
        title={editorMode === "create" ? "Thêm workflow" : t("wfAdminModalTitle").replace("{name}", selectedWorkflow?.name || "")}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={resetEditor}
              disabled={saving}
              className="rounded-xl font-semibold"
            >
              {t("wfAdminBtnCancel")}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveWorkflow}
              isLoading={saving}
              className="rounded-xl font-bold"
            >
              {t("wfAdminBtnSave")}
            </Button>
          </>
        }
      >
        {editorMode && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Workflow ID" hint="Dùng chữ thường, số, dấu - hoặc _." required>
                <Input
                  type="text"
                  value={editId}
                  disabled={editorMode === "edit"}
                  onChange={(e) => setEditId(e.target.value.replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="monthly-mmf-report"
                  className="h-10 rounded-xl font-mono"
                />
              </Field>
              <Field label="Tên workflow" required>
                <Input
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    if (editorMode === "create" && !editId) {
                      setEditId(slugFromText(e.target.value));
                    }
                  }}
                  placeholder="Monthly MMF Report"
                  className="h-10 rounded-xl"
                />
              </Field>
            </div>

            <Field label="Mô tả">
              <Input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Workflow dùng để..."
                className="h-10 rounded-xl"
              />
            </Field>

            <Field label="Command Alias" hint="Alias Telegram/menu, ví dụ monthly_mmf_report.">
              <Input
                type="text"
                value={editAlias}
                onChange={(e) => setEditAlias(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="monthly_mmf_report"
                className="h-10 rounded-xl"
              />
            </Field>

            <Field
              label={t("wfAdminLabelCron")}
              hint={t("wfAdminHintCron")}
            >
              <Input
                type="text"
                value={editCron}
                onChange={(e) => setEditCron(e.target.value)}
                placeholder="0 0 * * *"
                className="h-10 rounded-xl font-mono"
              />
            </Field>

            <div className="flex flex-wrap gap-4 text-sm font-semibold text-zinc-700">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editEnabled}
                  onChange={(e) => setEditEnabled(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                Enabled
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editShowInMenu}
                  onChange={(e) => setEditShowInMenu(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                Show in menu
              </label>
            </div>

            <Field label="Nội dung workflow" required>
              <MarkdownEditor
                value={editInstructions}
                onChange={(val) => setEditInstructions(val || "")}
                height={360}
                preview="live"
              />
            </Field>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
