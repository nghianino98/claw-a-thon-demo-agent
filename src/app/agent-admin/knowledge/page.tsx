"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import {
  normalizeKbVersions,
  normalizeSearchResults,
  type AgentKbVersion,
  type AgentSearchResult,
} from "@/lib/api/agent-admin";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { format } from "date-fns";
import {
  UploadCloud,
  Search,
  Database,
  Info,
  Play,
  Loader2,
  CheckCircle,
} from "lucide-react";

export default function KnowledgePage() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();
  const [versions, setVersions] = React.useState<AgentKbVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = React.useState(true);
  const [versionsError, setVersionsError] = React.useState<unknown>(null);

  // Upload state
  const [uploadProgress, setUploadProgress] = React.useState(0);
  const [uploading, setUploading] = React.useState(false);
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null);

  // Search Test state
  const [query, setQuery] = React.useState("");
  const [searching, setSearching] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<AgentSearchResult[]>([]);

  const loadVersions = React.useCallback(async () => {
    if (!selectedId) return;
    setLoadingVersions(true);
    setVersionsError(null);
    try {
      setVersions(normalizeKbVersions(await apiFetch("/api/agent-admin/kb")));
    } catch (err) {
      console.error(err);
      setVersionsError(err);
      toast.error(t("kbAdminLoadError"));
    } finally {
      setLoadingVersions(false);
    }
  }, [t, selectedId]);

  React.useEffect(() => {
    if (selectedId) {
      loadVersions();
    } else {
      setVersions([]);
      setLoadingVersions(false);
    }
  }, [selectedId, loadVersions]);

  // Chunked File Upload handler
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.name.endsWith(".zip")) {
      setSelectedFile(file);
      setUploadProgress(0);
    } else {
      toast.error(t("kbAdminInvalidFile"));
      setSelectedFile(null);
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || uploading) return;
    setUploading(true);
    setUploadProgress(10);

    try {
      const chunkSize = 1024 * 1024; // 1MB chunk
      const totalChunks = Math.ceil(selectedFile.size / chunkSize);
      
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, selectedFile.size);
        const chunk = selectedFile.slice(start, end);
        
        const formData = new FormData();
        formData.append("chunk", chunk);
        formData.append("chunkIndex", String(i));
        formData.append("totalChunks", String(totalChunks));
        formData.append("fileName", selectedFile.name);

        await apiFetch("/api/agent-admin/kb/upload", {
          method: "POST",
          body: formData,
        });
        setUploadProgress(Math.round(((i + 1) / totalChunks) * 100));
      }

      toast.success(t("kbAdminUploadSuccess"));
      setSelectedFile(null);
      setUploadProgress(0);
      loadVersions();
    } catch (err) {
      console.error(err);
      toast.error(t("kbAdminUploadFailed"));
    } finally {
      setUploading(false);
    }
  };

  // Search Test handler
  const handleSearchTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const data = await apiFetch("/api/agent-admin/kb/search-test", {
        method: "POST",
        body: JSON.stringify({ query: query.trim() }),
      });
      setSearchResults(normalizeSearchResults(data));
    } catch (err) {
      console.error(err);
      toast.error(t("kbAdminSearchError"));
    } finally {
      setSearching(false);
    }
  };

  // KB Activate version handler
  const handleActivate = async (version: string) => {
    try {
      await apiFetch(`/api/agent-admin/kb/${version}/activate`, {
        method: "POST",
      });
      toast.success(t("kbAdminActivateSuccess"));
      loadVersions();
    } catch (err) {
      console.error(err);
      toast.error(t("kbAdminActivateError"));
    }
  };

  return (
    <PageShell>
      <PageHeader
        title={t("kbAdminTitle")}
        subtitle={t("kbAdminSubtitle")}
        actions={<AgentConnectSelect />}
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">{t("agentConnectSelectAgent")}</p>
        </div>
      ) : (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main List and Upload area */}
        <div className="lg:col-span-2 space-y-8">
          {/* Upload zip chunked panel */}
          <RoleGate allowedRoles={["operator", "superadmin"]}>
            <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-6 space-y-4">
              <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
                <UploadCloud className="w-5 h-5 text-[--color-primary]" />
                {t("kbAdminUploadTitle")}
              </h3>

              <div className="border-2 border-dashed border-zinc-300 rounded-2xl p-8 text-center flex flex-col items-center justify-center bg-zinc-50 hover:bg-zinc-100/50 transition-colors relative">
                <input
                  type="file"
                  accept=".zip"
                  onChange={handleFileChange}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                  disabled={uploading}
                />
                <Database className="w-10 h-10 text-zinc-400 mb-3" />
                {selectedFile ? (
                  <div>
                    <p className="text-sm font-bold text-zinc-800">{selectedFile.name}</p>
                    <p className="text-xs text-zinc-500 mt-1">
                      {t("kbAdminFileSize").replace("{size}", Math.round(selectedFile.size / 1024).toString())}
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-semibold text-zinc-800">
                      {t("kbAdminDragDrop")}
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">{t("kbAdminZipOnly")}</p>
                  </div>
                )}
              </div>

              {uploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-xs font-semibold text-zinc-600">
                    <span>{t("kbAdminUploading")}</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="w-full bg-zinc-100 rounded-full h-2">
                    <div
                      className="bg-[--color-primary] h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {selectedFile && !uploading && (
                <div className="flex justify-end">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleUpload}
                    className="font-bold rounded-xl cursor-pointer"
                  >
                    {t("kbAdminBtnStartUpload")}
                  </Button>
                </div>
              )}
            </div>
          </RoleGate>

          {/* Versions Table */}
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-zinc-100 flex items-center justify-between">
              <h3 className="text-base font-bold text-zinc-900">{t("kbAdminTableTitle")}</h3>
            </div>
            {versionsError ? (
              <ErrorState
                errorType={getAgentErrorType(versionsError)}
                onRetry={loadVersions}
                className="rounded-none border-0 shadow-none"
              />
            ) : (
            <DataTable<AgentKbVersion>
              columns={[
                {
                  key: "version",
                  header: t("kbAdminThVersion"),
                  render: (row) => (
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-zinc-800">{row.version}</span>
                      {row.active && <Badge variant="success">{t("kbAdminStatusActive")}</Badge>}
                    </div>
                  ),
                },
                {
                  key: "type",
                  header: t("kbAdminThType"),
                  render: (row) => (
                    <Badge variant={row.type === "full" ? "default" : "warning"}>
                      {row.type === "full" ? "FULL" : "DELTA"}
                    </Badge>
                  ),
                },
                {
                  key: "sizeBytes",
                  header: t("kbAdminThSize"),
                  render: (row) => `${(row.sizeBytes / 1024 / 1024).toFixed(2)} MB`,
                },
                {
                  key: "chunks",
                  header: t("kbAdminThChunks"),
                  render: (row) => row.chunks || "-",
                },
                {
                  key: "files",
                  header: t("kbAdminThFiles"),
                  render: (row) => row.files || "-",
                },
                {
                  key: "createdAt",
                  header: t("kbAdminThDate"),
                  render: (row) => format(row.createdAt, "dd/MM/yyyy HH:mm"),
                },
                {
                  key: "actions",
                  header: t("accessThActions"), // using common Actions header
                  align: "right",
                  render: (row) => (
                    <div className="flex items-center justify-end gap-2">
                      {!row.active ? (
                        <RoleGate allowedRoles={["operator", "superadmin"]}>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleActivate(row.version)}
                            className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                            {t("kbAdminBtnActivate")}
                          </Button>
                        </RoleGate>
                      ) : (
                        <span className="text-xs text-zinc-400 font-semibold">-</span>
                      )}
                    </div>
                  ),
                },
              ]}
              data={versions}
              isLoading={loadingVersions}
              emptyText={t("kbAdminEmpty")}
            />
            )}
          </div>
        </div>

        {/* Search Test Playground */}
        <div className="space-y-6">
          <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-6 space-y-4">
            <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2">
              <Search className="w-5 h-5 text-[--color-primary]" />
              {t("kbAdminSearchTitle")}
            </h3>
            <p className="text-xs text-zinc-500 leading-relaxed">
              {t("kbAdminSearchDesc")}
            </p>

            <form onSubmit={handleSearchTest} className="space-y-3">
              <div className="relative">
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t("kbAdminSearchPh")}
                  className="w-full h-10 pl-3 pr-10 rounded-xl border border-zinc-300 focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary] text-xs shadow-sm bg-white"
                  required
                />
                <button
                  type="submit"
                  disabled={searching || !query.trim()}
                  className="absolute right-2 top-2 text-zinc-400 hover:text-[--color-primary] disabled:opacity-50 cursor-pointer"
                >
                  {searching ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <Play className="w-5 h-5 fill-current" />
                  )}
                </button>
              </div>
            </form>

            {/* Results */}
            <div className="space-y-3 pt-2 max-h-[400px] overflow-y-auto pr-1">
              {searchResults.length > 0 ? (
                searchResults.map((res, idx) => (
                  <div
                    key={idx}
                    className="p-4 bg-zinc-50 border border-zinc-200/50 rounded-2xl space-y-2 text-xs"
                  >
                    <div className="flex justify-between items-start">
                      <span className="font-bold text-zinc-800 break-all">{res.filePath}</span>
                      <Badge variant="success">{(res.score * 100).toFixed(0)}%</Badge>
                    </div>
                    <p className="text-zinc-600 leading-relaxed font-medium bg-white p-2.5 rounded-xl border border-zinc-200/50">
                      {res.content}
                    </p>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-zinc-400 flex flex-col items-center gap-1.5 border border-dashed border-zinc-200 rounded-2xl bg-zinc-50/50">
                  <Info className="w-5 h-5 opacity-40" />
                  <span className="text-[11px]">{t("kbAdminSearchEmpty")}</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      )}
    </PageShell>
  );
}
