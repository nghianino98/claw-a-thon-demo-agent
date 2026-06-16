"use client";

import * as React from "react";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import { normalizeAuditList, type AgentAuditLog } from "@/lib/api/agent-admin";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { format } from "date-fns";
import { Search, X, ChevronRight } from "lucide-react";

export default function AuditPage() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();
  const [logs, setLogs] = React.useState<AgentAuditLog[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);

  // Filter states
  const [actor, setActor] = React.useState("");
  const [action, setAction] = React.useState("");
  const [status, setStatus] = React.useState("");

  // Pagination states
  const [currentPage, setCurrentPage] = React.useState(1);
  const [pageSize] = React.useState(20);
  const [totalLogs, setTotalLogs] = React.useState(0);

  const loadAuditLogs = React.useCallback(async () => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    try {
      const offset = (currentPage - 1) * pageSize;
      const queryParams = new URLSearchParams({
        limit: String(pageSize),
        offset: String(offset),
        ...(actor ? { actor: actor.trim() } : {}),
        ...(action ? { action: action.trim() } : {}),
        ...(status ? { status } : {}),
      });

      const data = normalizeAuditList(await apiFetch(`/api/agent-admin/audit?${queryParams}`));

      setLogs(data.logs);
      setTotalLogs(data.total);
    } catch (err) {
      console.error(err);
      setError(err);
      toast.error(t("auditLoadError"));
    } finally {
      setLoading(false);
    }
  }, [currentPage, pageSize, actor, action, status, t, selectedId]);

  React.useEffect(() => {
    if (selectedId) {
      loadAuditLogs();
    } else {
      setLogs([]);
      setTotalLogs(0);
      setLoading(false);
    }
  }, [selectedId, loadAuditLogs]);

  const handleClearFilters = () => {
    setActor("");
    setAction("");
    setStatus("");
    setCurrentPage(1);
  };

  const handleApplyFilters = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentPage(1);
    loadAuditLogs();
  };

  const totalPages = Math.ceil(totalLogs / pageSize);

  return (
    <PageShell>
      <PageHeader
        title={t("auditTitle")}
        subtitle={t("auditSubtitle")}
        actions={<AgentConnectSelect />}
      />

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">Chọn Agent Connect để xem dữ liệu.</p>
        </div>
      ) : (<>
      {/* Filter Section */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm p-5 mb-6">
        <form onSubmit={handleApplyFilters} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <Field label={t("auditLabelActor")}>
            <Input
              type="text"
              value={actor}
              onChange={(e) => setActor(e.target.value)}
              placeholder={t("auditPhActor")}
              className="h-10 rounded-xl text-xs bg-white border border-zinc-300"
            />
          </Field>

          <Field label={t("auditLabelAction")}>
            <Input
              type="text"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder={t("auditPhAction")}
              className="h-10 rounded-xl text-xs bg-white border border-zinc-300"
            />
          </Field>

          <Field label={t("auditLabelStatus")}>
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: "", label: t("auditStatusAll") },
                { value: "success", label: t("auditStatusSuccess") },
                { value: "failure", label: t("auditStatusFailed") },
              ]}
            />
          </Field>

          <div className="flex gap-2">
            <Button
              type="submit"
              variant="primary"
              className="flex-1 h-10 flex items-center justify-center gap-1.5 font-bold cursor-pointer rounded-xl text-xs"
            >
              <Search className="w-4 h-4" />
              {t("auditBtnFilter")}
            </Button>
            {(actor || action || status) && (
              <Button
                type="button"
                variant="outline"
                onClick={handleClearFilters}
                className="h-10 flex items-center justify-center p-2.5 cursor-pointer rounded-xl"
                title={t("auditBtnClearFilters")}
              >
                <X className="w-4 h-4 text-zinc-500" />
              </Button>
            )}
          </div>
        </form>
      </div>

      {/* Logs Table */}
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden mb-12">
        {error ? (
          <ErrorState
            errorType={getAgentErrorType(error)}
            onRetry={loadAuditLogs}
            className="rounded-none border-0 shadow-none"
          />
        ) : (
        <DataTable<AgentAuditLog>
          columns={[
            {
              key: "actor",
              header: t("auditThActor"),
              render: (row) => <span className="font-bold text-zinc-800">{row.actor}</span>,
            },
            {
              key: "action",
              header: t("auditThAction"),
              render: (row) => <Badge variant="secondary">{row.action}</Badge>,
            },
            { key: "target", header: t("auditThTarget") },
            {
              key: "timestamp",
              header: t("auditThTime"),
              render: (row) => format(row.timestamp, "dd/MM/yyyy HH:mm:ss"),
            },
            {
              key: "status",
              header: t("auditThStatus"),
              align: "right",
              render: (row) => (
                <Badge variant={row.status === "success" ? "success" : "danger"}>
                  {row.status === "success" ? t("auditStatusSuccess") : t("auditStatusFailed")}
                </Badge>
              ),
            },
          ]}
          data={logs}
          isLoading={loading}
          emptyText={t("auditEmpty")}
        />
        )}

        {/* Pagination Footer */}
        {!loading && totalPages > 1 && (
          <div className="bg-zinc-50 border-t border-zinc-100 px-6 py-4 flex items-center justify-between">
            <div className="text-xs text-zinc-500 font-semibold">
              {t("auditPaginationShowing")
                .replace("{from}", ((currentPage - 1) * pageSize + 1).toString())
                .replace("{to}", Math.min(currentPage * pageSize, totalLogs).toString())
                .replace("{total}", totalLogs.toString())}
            </div>

            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>

              <span className="text-xs font-bold text-zinc-700 px-2">
                {t("auditPaginationPage")
                  .replace("{current}", currentPage.toString())
                  .replace("{total}", totalPages.toString())}
              </span>

              <button
                onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg hover:bg-zinc-200 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
      </>)}
    </PageShell>
  );
}
