"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { RoleGate } from "@/components/ui/role-gate";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import { normalizeRunDetail, normalizeWorkflows, type AgentRunDetail, type AgentWorkflow } from "@/lib/api/agent-admin";
import { agentRunArtifactPath } from "@/lib/api/agent-connections";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { toast } from "@/lib/store/toast-store";
import { CalendarDays, Download, FileText, Loader2, Play, RefreshCw } from "lucide-react";

function defaultReportMonth() {
  const date = new Date();
  date.setMonth(date.getMonth() - 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function runStatusVariant(status?: AgentRunDetail["status"]): "success" | "danger" | "secondary" | "warning" {
  if (status === "success") return "success";
  if (status === "failure") return "danger";
  if (status === "cancelled") return "secondary";
  return "warning";
}

export default function ReportsPage() {
  const selectedAgentConnectId = useAgentConnectStore((state) => state.selectedId);
  const [workflows, setWorkflows] = React.useState<AgentWorkflow[]>([]);
  const [workflowId, setWorkflowId] = React.useState("monthly-mmf-report");
  const [month, setMonth] = React.useState(defaultReportMonth());
  const [product, setProduct] = React.useState("MMF");
  const [notes, setNotes] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [starting, setStarting] = React.useState(false);
  const [activeRunId, setActiveRunId] = React.useState<string>("");
  const [runDetail, setRunDetail] = React.useState<AgentRunDetail | null>(null);
  const pollRef = React.useRef<NodeJS.Timeout | null>(null);

  const loadWorkflows = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = normalizeWorkflows(await apiFetch("/api/agent-admin/workflows"));
      setWorkflows(next);
      const preferred = next.find((item) => item.id === "monthly-mmf-report") || next.find((item) => item.name.toLowerCase().includes("monthly"));
      if (preferred) setWorkflowId(preferred.id);
    } catch (err) {
      console.error(err);
      setError(err);
      toast.error("Không thể tải workflows từ Quéo.");
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRun = React.useCallback(async (runId: string) => {
    const detail = normalizeRunDetail(await apiFetch(`/api/agent-admin/runs/${runId}`));
    setRunDetail(detail);
    if (detail.status !== "running" && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    loadWorkflows();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadWorkflows]);

  const startReport = async () => {
    if (starting || !workflowId) return;
    setStarting(true);
    setRunDetail(null);
    try {
      const response = (await apiFetch(`/api/agent-admin/workflows/${workflowId}/run`, {
        method: "POST",
        body: JSON.stringify({
          params: {
            report_type: "monthly_report",
            month,
            product,
            notes,
            requested_outputs: ["markdown", "pdf"],
          },
        }),
      })) as Record<string, unknown>;
      const runId = String(response.run_id || response.id || "");
      if (!runId) throw new Error("Agent không trả run_id.");
      setActiveRunId(runId);
      toast.success(`Đã bắt đầu run #${runId}.`);
      await fetchRun(runId);
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        fetchRun(runId).catch((err) => {
          console.error(err);
          toast.error("Không thể cập nhật trạng thái report.");
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        });
      }, 2500);
    } catch (err) {
      console.error(err);
      toast.error("Không thể khởi chạy monthly report.");
    } finally {
      setStarting(false);
    }
  };

  const selectedWorkflow = workflows.find((item) => item.id === workflowId);

  return (
    <PageShell>
      <PageHeader
        title="Monthly Reports"
        subtitle="Chạy workflow report trên Quéo và tải artifact sau khi hoàn tất."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <AgentConnectSelect onChange={() => loadWorkflows()} />
            <Button variant="outline" size="sm" onClick={loadWorkflows} className="gap-1.5 rounded-xl font-bold">
              <RefreshCw className="h-4 w-4" />
              Làm mới
            </Button>
          </div>
        }
      />

      {error ? (
        <ErrorState errorType={getAgentErrorType(error)} onRetry={loadWorkflows} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(360px,440px)_1fr]">
          <Card className="rounded-xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-[--color-primary]" />
                Tạo report tháng
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="Workflow">
                <Select
                  value={workflowId}
                  onChange={(event) => setWorkflowId(event.target.value)}
                  disabled={loading}
                  options={workflows.map((item) => ({ value: item.id, label: `${item.name} (${item.id})` }))}
                  className="rounded-xl"
                />
              </Field>
              <Field label="Tháng">
                <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} className="h-10 rounded-xl" />
              </Field>
              <Field label="Sản phẩm">
                <Select
                  value={product}
                  onChange={(event) => setProduct(event.target.value)}
                  options={[
                    { value: "MMF", label: "MMF" },
                    { value: "FD", label: "FD" },
                    { value: "Investment", label: "Investment" },
                  ]}
                  className="rounded-xl"
                />
              </Field>
              <Field label="Ghi chú đầu vào">
                <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="min-h-[144px] rounded-xl" />
              </Field>
              <RoleGate allowedRoles={["operator", "superadmin"]}>
                <Button
                  variant="primary"
                  onClick={startReport}
                  disabled={starting || loading || !workflowId}
                  className="h-10 w-full gap-2 rounded-xl font-bold"
                >
                  {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
                  Chạy report
                </Button>
              </RoleGate>
              {selectedWorkflow && (
                <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                  <div className="font-bold text-zinc-800">{selectedWorkflow.description || selectedWorkflow.name}</div>
                  <div className="mt-1 font-mono">{selectedWorkflow.cronSchedule || "manual"}</div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center justify-between gap-3 text-base">
                <span className="flex items-center gap-2">
                  <FileText className="h-4 w-4 text-[--color-primary]" />
                  Kết quả
                </span>
                {activeRunId && <code className="rounded bg-zinc-100 px-2 py-1 text-xs">#{activeRunId}</code>}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {!activeRunId ? (
                <div className="flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-zinc-200 text-sm font-semibold text-zinc-400">
                  Chưa có report run trong phiên này.
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge variant={runStatusVariant(runDetail?.status)}>{runDetail?.status || "running"}</Badge>
                    <Button variant="outline" size="sm" onClick={() => fetchRun(activeRunId)} className="gap-1 rounded-xl">
                      <RefreshCw className="h-3.5 w-3.5" />
                      Cập nhật
                    </Button>
                  </div>
                  <div className="rounded-xl border border-zinc-200 bg-zinc-950 p-4">
                    <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap text-xs leading-5 text-zinc-100">
                      {runDetail?.logs || "Đang chờ log từ Agent..."}
                    </pre>
                  </div>
                  {runDetail?.artifacts.length ? (
                    <div className="flex flex-wrap gap-2">
                      {runDetail.artifacts.map((artifact) => (
                        <a
                          key={artifact.name}
                          href={selectedAgentConnectId ? agentRunArtifactPath(selectedAgentConnectId, activeRunId, artifact.name) : artifact.url}
                          download
                          className="inline-flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100"
                        >
                          <Download className="h-4 w-4" />
                          {artifact.name}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
