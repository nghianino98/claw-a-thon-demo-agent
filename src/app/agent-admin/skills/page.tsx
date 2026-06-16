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
import { normalizeSkills, type AgentSkill } from "@/lib/api/agent-admin";
import { parseMarkdownMetadata, slugFromText } from "@/lib/agent-admin/markdown-upload";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { Edit2, Plus, Upload, Trash2, ChevronLeft, ChevronRight } from "lucide-react";

export default function SkillsPage() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();
  const [skills, setSkills] = React.useState<AgentSkill[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);

  // Pagination states
  const [currentPage, setCurrentPage] = React.useState(1);
  const pageSize = 10;

  const totalPages = React.useMemo(() => {
    return Math.max(1, Math.ceil(skills.length / pageSize));
  }, [skills.length, pageSize]);

  const paginatedSkills = React.useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return skills.slice(start, start + pageSize);
  }, [skills, currentPage, pageSize]);

  // Reset page if it exceeds totalPages
  React.useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [skills.length, totalPages, currentPage]);

  // Editor states
  const [selectedSkill, setSelectedSkill] = React.useState<AgentSkill | null>(null);
  const [editorMode, setEditorMode] = React.useState<"create" | "edit" | null>(null);
  const [editId, setEditId] = React.useState("");
  const [editName, setEditName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editAlias, setEditAlias] = React.useState("");
  const [editTriggers, setEditTriggers] = React.useState("");
  const [editInstructions, setEditInstructions] = React.useState("");
  const [editEnabled, setEditEnabled] = React.useState(true);
  const [editShowInMenu, setEditShowInMenu] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [uploading, setUploading] = React.useState(false);
  const uploadInputRef = React.useRef<HTMLInputElement>(null);

  const loadSkills = React.useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      setSkills(normalizeSkills(await apiFetch("/api/agent-admin/skills")));
    } catch (err) {
      console.error(err);
      setError(err);
      toast.error(t("skillsLoadError"));
    } finally {
      setLoading(false);
    }
  }, [t, selectedId]);

  React.useEffect(() => {
    setCurrentPage(1);
    if (selectedId) {
      loadSkills();
    } else {
      setSkills([]);
      setLoading(false);
    }
  }, [selectedId, loadSkills]);

  const resetEditor = () => {
    setSelectedSkill(null);
    setEditorMode(null);
    setEditId("");
    setEditName("");
    setEditDescription("");
    setEditAlias("");
    setEditTriggers("");
    setEditInstructions("");
    setEditEnabled(true);
    setEditShowInMenu(true);
  };

  const handleCreateSkill = () => {
    setSelectedSkill(null);
    setEditorMode("create");
    setEditId("");
    setEditName("");
    setEditDescription("");
    setEditAlias("");
    setEditTriggers("");
    setEditInstructions("---\nname: \ndescription: \n---\n\n# Skill Instructions\n");
    setEditEnabled(true);
    setEditShowInMenu(true);
  };

  const handleToggleEnable = async (skill: AgentSkill) => {
    const nextStatus = !skill.enabled;
    try {
      await apiFetch(`/api/agent-admin/skills/${skill.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextStatus }),
      });
      toast.success(nextStatus ? t("skillsToggleSuccessActive") : t("skillsToggleSuccessInactive"));
      // Local update
      setSkills((prev) =>
        prev.map((s) => (s.id === skill.id ? { ...s, enabled: nextStatus } : s))
      );
    } catch (err) {
      console.error(err);
      toast.error(t("skillsToggleError"));
    }
  };

  const handleOpenEditor = (skill: AgentSkill) => {
    setSelectedSkill(skill);
    setEditorMode("edit");
    setEditId(skill.id);
    setEditName(skill.name);
    setEditDescription(skill.description);
    setEditAlias(skill.commandAlias || "");
    setEditTriggers(skill.triggers.join("\n"));
    setEditInstructions(skill.instructions || "");
    setEditEnabled(skill.enabled);
    setEditShowInMenu(skill.showInMenu);
  };

  const handleDeleteSkill = async (skill: AgentSkill) => {
    if (!window.confirm(t("skillsConfirmDelete").replace("{name}", skill.name))) {
      return;
    }
    try {
      await apiFetch(`/api/agent-admin/skills/${skill.id}`, {
        method: "DELETE",
      });
      toast.success(t("skillsDeleteSuccess"));
      loadSkills();
    } catch (err) {
      console.error(err);
      toast.error(t("skillsDeleteError"));
    }
  };

  const handleSaveSkill = async () => {
    if (!editorMode || saving) return;
    setSaving(true);
    const normalizedId = slugFromText(editId || editName);
    const alias = editAlias.trim() || normalizedId.replace(/-/g, "_").slice(0, 32);
    const body = {
      name: editName.trim(),
      description: editDescription.trim(),
      triggers: editTriggers.trim(),
      content_override: editInstructions,
      enabled: editEnabled,
      command_alias: alias,
      show_in_menu: editShowInMenu,
    };
    try {
      if (editorMode === "create") {
        await apiFetch("/api/agent-admin/skills", {
          method: "POST",
          body: JSON.stringify({ ...body, skill_id: normalizedId }),
        });
      } else if (selectedSkill) {
        await apiFetch(`/api/agent-admin/skills/${selectedSkill.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      toast.success(editorMode === "create" ? t("skillsAddSuccess") : t("skillsUpdateSuccess"));
      resetEditor();
      loadSkills();
    } catch (err) {
      console.error(err);
      if (getHttpErrorStatus(err) === 409) {
        toast.error(t("skillsDuplicateAlias"));
      } else {
        toast.error(t("skillsUpdateError"));
      }
    } finally {
      setSaving(false);
    }
  };

  const handleUploadSkill = async (file: File | null) => {
    if (!file || uploading) return;
    if (!file.name.toLowerCase().endsWith(".md")) {
      toast.error(t("skillsUploadMdOnly"));
      return;
    }
    setUploading(true);
    try {
      const content = await file.text();
      const meta = parseMarkdownMetadata(content, file.name);
      const body = {
        skill_id: meta.id,
        name: meta.name,
        description: meta.description || meta.name,
        triggers: "",
        content_override: content,
        enabled: true,
        command_alias: meta.id.replace(/-/g, "_").slice(0, 32),
        show_in_menu: true,
      };
      try {
        await apiFetch("/api/agent-admin/skills", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } catch (err) {
        if (getHttpErrorStatus(err) !== 409) throw err;
        await apiFetch(`/api/agent-admin/skills/${meta.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            name: body.name,
            description: body.description,
            content_override: content,
          }),
        });
      }
      toast.success(t("skillsUploadSuccess").replace("{name}", meta.name));
      loadSkills();
    } catch (err) {
      console.error(err);
      toast.error(t("skillsUploadError"));
    } finally {
      setUploading(false);
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("skillsTitle")}
        subtitle={t("skillsSubtitle")}
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
              onChange={(event) => handleUploadSkill(event.target.files?.[0] || null)}
            />
            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateSkill}
              className="flex items-center gap-1.5 rounded-xl font-bold"
            >
              <Plus className="h-4 w-4" />
              {t("skillsBtnAdd")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => uploadInputRef.current?.click()}
              isLoading={uploading}
              className="flex items-center gap-1.5 rounded-xl font-bold"
            >
              <Upload className="h-4 w-4" />
              {t("skillsBtnUpload")}
            </Button>
          </div>
            </RoleGate>
          </div>
        }
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400 gap-2">
          <p className="text-sm font-semibold">{t("agentConnectSelectAgent")}</p>
        </div>
      ) : error ? (
        <ErrorState errorType={getAgentErrorType(error)} onRetry={loadSkills} />
      ) : (
        <div className="space-y-4">
          <DataTable<AgentSkill>
            columns={[
              {
                key: "name",
                header: t("skillsThName"),
                className: "whitespace-normal max-w-md break-words",
                render: (row) => (
                  <div>
                    <span className="font-bold text-zinc-900">{row.name}</span>
                    <p className="text-xs text-zinc-500 mt-0.5">{row.description}</p>
                  </div>
                ),
              },
              {
                key: "commandAlias",
                header: t("skillsThAlias"),
                render: (row) => (
                  <code className="text-xs bg-zinc-100 border border-zinc-200 px-1.5 py-0.5 rounded font-mono font-bold text-[--color-primary]">
                    /{row.commandAlias || t("skillsNoAlias")}
                  </code>
                ),
              },
              {
                key: "enabled",
                header: t("skillsThStatus"),
                render: (row) => (
                  <div className="flex items-center gap-2">
                    <Badge variant={row.enabled ? "success" : "secondary"}>
                      {row.enabled ? t("skillsStatusOn") : t("skillsStatusOff")}
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
                header: t("skillsThActions"),
                align: "right",
                render: (row) => (
                  <div className="flex items-center justify-end gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleOpenEditor(row)}
                      className="flex items-center gap-1.5 cursor-pointer rounded-xl"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      {t("skillsBtnConfigure")}
                    </Button>
                    {row.source === "admin" && (
                      <RoleGate allowedRoles={["operator", "superadmin"]}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteSkill(row)}
                          className="flex items-center gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 cursor-pointer rounded-xl"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t("skillsBtnDelete")}
                        </Button>
                      </RoleGate>
                    )}
                  </div>
                ),
              },
            ]}
            data={paginatedSkills}
            isLoading={loading}
            emptyText={t("skillsEmpty")}
          />

          {!loading && totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 px-6 py-4 bg-white border border-zinc-200 rounded-2xl shadow-sm">
              <div className="text-xs font-semibold text-zinc-500">
                {t("skillsPaginationStats")
                  .replace("{start}", String(Math.min(skills.length, (currentPage - 1) * pageSize + 1)))
                  .replace("{end}", String(Math.min(skills.length, currentPage * pageSize)))
                  .replace("{total}", String(skills.length))}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage === 1}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 border border-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-zinc-600 bg-white cursor-pointer"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="text-xs font-bold text-zinc-700 px-3 py-1.5 bg-zinc-50 border border-zinc-200 rounded-lg">
                  {t("skillsPaginationPage")
                    .replace("{current}", String(currentPage))
                    .replace("{total}", String(totalPages))}
                </span>
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={currentPage === totalPages}
                  className="p-1.5 rounded-lg hover:bg-zinc-100 border border-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all text-zinc-600 bg-white cursor-pointer"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Editor Overlay Modal */}
      <Modal
        isOpen={!!editorMode}
        onClose={resetEditor}
        title={editorMode === "create" ? t("skillsBtnAdd") : t("skillsModalTitle").replace("{name}", selectedSkill?.name || "")}
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
              {t("skillsBtnCancel")}
            </Button>
            <RoleGate allowedRoles={["operator", "superadmin"]}>
              <Button
                variant="primary"
                size="sm"
                onClick={handleSaveSkill}
                isLoading={saving}
                className="rounded-xl font-bold"
              >
                {t("skillsBtnSave")}
              </Button>
            </RoleGate>
          </>
        }
      >
        {editorMode && (
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={t("skillsLabelId")} hint={t("skillsHintId")} required>
                <Input
                  type="text"
                  value={editId}
                  disabled={editorMode === "edit"}
                  onChange={(e) => setEditId(e.target.value.replace(/[^a-z0-9_-]/g, ""))}
                  placeholder="monthly-memo"
                  className="h-10 rounded-xl font-mono"
                />
              </Field>
              <Field label={t("skillsLabelName")} required>
                <Input
                  type="text"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    if (editorMode === "create" && !editId) {
                      setEditId(slugFromText(e.target.value));
                    }
                  }}
                  placeholder="Monthly Memo"
                  className="h-10 rounded-xl"
                />
              </Field>
            </div>

            <Field label={t("skillsLabelDesc")}>
              <Input
                type="text"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t("skillsPhDesc")}
                className="h-10 rounded-xl"
              />
            </Field>

            <Field label={t("skillsLabelTriggers")} hint={t("skillsHintTriggers")}>
              <Input
                type="text"
                value={editTriggers}
                onChange={(e) => setEditTriggers(e.target.value)}
                placeholder="monthly report, mmf, memo"
                className="h-10 rounded-xl"
              />
            </Field>

            <Field
              label={t("skillsLabelAlias")}
              hint={t("skillsHintAlias")}
              required
            >
              <Input
                type="text"
                value={editAlias}
                onChange={(e) => setEditAlias(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder={t("skillsPhAlias")}
                className="h-10 rounded-xl"
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
                {t("skillsFieldEnabled")}
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={editShowInMenu}
                  onChange={(e) => setEditShowInMenu(e.target.checked)}
                  className="h-4 w-4 rounded border-zinc-300"
                />
                {t("skillsFieldShowMenu")}
              </label>
            </div>

            <Field label={t("skillsLabelPrompt")} required>
              <MarkdownEditor
                value={editInstructions}
                onChange={(val) => setEditInstructions(val || "")}
                height={350}
                preview="live"
              />
            </Field>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
