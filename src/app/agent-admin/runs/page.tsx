"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import { normalizeRunDetail, normalizeRuns, type AgentRun } from "@/lib/api/agent-admin";
import { agentRunArtifactPath } from "@/lib/api/agent-connections";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { format } from "date-fns";
import { Terminal, Download, StopCircle, RefreshCw, Eye } from "lucide-react";

export default function RunsPage() {
  const t = useTranslation();
  const selectedAgentConnectId = useAgentConnectStore((state) => state.selectedId);
  const [runs, setRuns] = React.useState<AgentRun[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);

  // Drawer & log polling states
  const [activeRunId, setActiveRunId] = React.useState<string | null>(null);
  const [activeRunTitle, setActiveRunTitle] = React.useState("");
  const [logsText, setLogsText] = React.useState("");
  const [activeRunStatus, setActiveRunStatus] = React.useState<AgentRun["status"] | null>(null);

  const logsEndRef = React.useRef<HTMLDivElement>(null);
  const pollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  const loadRuns = React.useCallback(async (silent = false) => {
    if (!selectedAgentConnectId) return;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      setRuns(normalizeRuns(await apiFetch("/api/agent-admin/runs")));
    } catch (err) {
      console.error(err);
      if (!silent) setError(err);
      toast.error(t("runsLoadError"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t, selectedAgentConnectId]);

  React.useEffect(() => {
    if (selectedAgentConnectId) {
      loadRuns();
    } else {
      setRuns([]);
      setLoading(false);
    }
  }, [selectedAgentConnectId, loadRuns]);

  // Handle Log Polling
  const fetchLogs = React.useCallback(async (runId: string) => {
    try {
      const res = normalizeRunDetail(await apiFetch(`/api/agent-admin/runs/${runId}`));

      setLogsText(res.logs || t("runsNoLogs"));
      setActiveRunStatus(res.status);

      // Auto scroll logs
      setTimeout(() => {
        logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }, 50);

      // Stop polling if complete
      if (res.status !== "running" && pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        loadRuns(true);
      }
    } catch (err) {
      console.error("Failed to poll logs", err);
      setLogsText("Không thể tải log run từ Agent. Vui lòng thử lại sau.");
      setActiveRunStatus("failure");
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    }
  }, [loadRuns, t]);

  const handleOpenDrawer = (run: AgentRun) => {
    setActiveRunId(run.id);
    setActiveRunTitle(t("runsDrawerTitle").replace("{name}", run.jobName).replace("{id}", run.id));
    setLogsText(t("loading"));
    setActiveRunStatus(run.status);

    fetchLogs(run.id);

    // If running, poll every 2 seconds
    if (run.status === "running") {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = setInterval(() => {
        fetchLogs(run.id);
      }, 2000);
    }
  };

  const handleCloseDrawer = () => {
    setActiveRunId(null);
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
  };

  const handleCancelRun = async (runId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(t("runsConfirmCancel"))) return;

    try {
      await apiFetch(`/api/agent-admin/runs/${runId}/cancel`, {
        method: "POST",
      });
      toast.success(t("runsCancelSuccess"));
      loadRuns(true);
      if (activeRunId === runId) {
        fetchLogs(runId);
      }
    } catch (err) {
      console.error(err);
      toast.error(t("runsCancelError"));
    }
  };

  React.useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  return (
    <PageShell>
      <PageHeader
        title={t("runsTitle")}
        subtitle={t("runsSubtitle")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentConnectSelect />
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadRuns()}
              className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl"
            >
              <RefreshCw className="w-4 h-4" />
              {t("runsBtnRefresh")}
            </Button>
          </div>
        }
      />

      {!selectedAgentConnectId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">Chọn Agent Connect để xem dữ liệu.</p>
        </div>
      ) : error ? (
        <ErrorState errorType={getAgentErrorType(error)} onRetry={() => loadRuns()} />
      ) : (
      <DataTable<AgentRun>
        columns={[
          { key: "id", header: t("runsThId"), render: (row) => <code className="font-mono text-xs">{row.id}</code> },
          { key: "jobName", header: t("runsThJobName"), render: (row) => <span className="font-bold text-zinc-900">{row.jobName}</span> },
          { key: "triggeredBy", header: t("runsThTriggeredBy") },
          {
            key: "createdAt",
            header: t("runsThTime"),
            render: (row) => format(row.createdAt, "dd/MM/yyyy HH:mm:ss"),
          },
          {
            key: "completedAt",
            header: t("runsThDuration"),
            render: (row) => {
              if (row.completedAt) {
                const diff = Math.round((row.completedAt - row.createdAt) / 1000);
                return `${diff} ${t("runsSec")}`;
              }
              return row.status === "running" ? t("runsDurationRunning") : t("runsDurationCancelled");
            },
          },
          {
            key: "status",
            header: t("runsThResult"),
            render: (row) => (
              <Badge
                variant={
                  row.status === "success"
                    ? "success"
                    : row.status === "failure"
                    ? "danger"
                    : row.status === "running"
                    ? "warning"
                    : "secondary"
                }
              >
                {row.status === "success"
                  ? t("runsStatusSuccess")
                  : row.status === "failure"
                  ? t("runsStatusFailed")
                  : row.status === "running"
                  ? t("runsStatusRunning")
                  : t("runsStatusCancelled")}
              </Badge>
            ),
          },
          {
            key: "actions",
            header: t("runsThActions"),
            align: "right",
            render: (row) => (
              <div className="flex items-center justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleOpenDrawer(row)}
                  className="flex items-center gap-1 cursor-pointer rounded-xl"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {t("runsBtnViewLogs")}
                </Button>
                {row.status === "running" && (
                  <RoleGate allowedRoles={["operator", "superadmin"]}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => handleCancelRun(row.id, e)}
                      className="flex items-center gap-1 text-[--color-danger] hover:text-red-700 cursor-pointer rounded-xl"
                    >
                      <StopCircle className="w-3.5 h-3.5" />
                      {t("runsBtnStop")}
                    </Button>
                  </RoleGate>
                )}
                {row.artifacts && row.artifacts.length > 0 && (
                  <a
                    href={selectedAgentConnectId ? agentRunArtifactPath(selectedAgentConnectId, row.id, row.artifacts[0].name) : row.artifacts[0].url}
                    download
                    className="inline-flex items-center gap-1 text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 rounded-xl px-2.5 py-1.5 font-bold transition-all"
                  >
                    <Download className="w-3.5 h-3.5" />
                    {t("runsBtnDownload")}
                  </a>
                )}
              </div>
            ),
          },
        ]}
        data={runs}
        isLoading={loading}
        emptyText={t("runsEmpty")}
      />
      )}

      {/* Real-time Log Drawer */}
      <Drawer
        isOpen={!!activeRunId}
        onClose={handleCloseDrawer}
        title={activeRunTitle}
      >
        <div className="flex flex-col h-full bg-zinc-950 text-gray-200 font-mono text-xs p-6 overflow-y-auto min-h-0">
          <div className="shrink-0 mb-4 pb-3 border-b border-zinc-800 flex justify-between items-center">
            <span className="flex items-center gap-1.5 text-zinc-400">
              <Terminal className="w-4 h-4" /> Console Output
            </span>
            <div className="flex items-center gap-2">
              <Badge
                variant={
                  activeRunStatus === "success"
                    ? "success"
                    : activeRunStatus === "failure"
                    ? "danger"
                    : activeRunStatus === "running"
                    ? "warning"
                    : "secondary"
                }
              >
                {activeRunStatus === "success"
                  ? t("runsStatusSuccess")
                  : activeRunStatus === "failure"
                  ? t("runsStatusFailed")
                  : activeRunStatus === "running"
                  ? t("runsStatusRunning")
                  : t("runsStatusCancelled")}
              </Badge>
              {activeRunStatus === "running" && (
                <div className="w-2.5 h-2.5 bg-yellow-500 rounded-full animate-ping" />
              )}
            </div>
          </div>
          <pre className="flex-1 whitespace-pre-wrap font-mono leading-relaxed select-text min-h-0 overflow-y-auto">
            {logsText}
          </pre>
          <div ref={logsEndRef} />
        </div>
      </Drawer>
    </PageShell>
  );
}
