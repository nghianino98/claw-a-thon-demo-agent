"use client";

import * as React from "react";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RoleGate } from "@/components/ui/role-gate";
import { Tabs } from "@/components/ui/tabs";
import { ErrorState } from "@/components/ui/error-state";
import { AgentConnectSelect } from "@/components/agent-connections/agent-connect-select";
import { apiFetch, getAgentErrorType } from "@/lib/api/client";
import { normalizeAccessUsers, type AgentAccessUser } from "@/lib/api/agent-admin";
import { toast } from "@/lib/store/toast-store";
import { useTranslation } from "@/lib/store/i18n-store";
import { useAgentConnectStore } from "@/lib/store/agent-connect-store";
import { RefreshCw, UserCheck, UserX, ShieldCheck, Clock, Ban } from "lucide-react";
import { format } from "date-fns";

export function BotAccessPanel() {
  const t = useTranslation();
  const { selectedId } = useAgentConnectStore();
  const [users, setUsers] = React.useState<AgentAccessUser[]>([]);
  const [allUsers, setAllUsers] = React.useState<AgentAccessUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<unknown>(null);
  const [processingId, setProcessingId] = React.useState<string | null>(null);
  const [statusFilter, setStatusFilter] = React.useState("");

  const loadUsers = React.useCallback(async (silent = false) => {
    if (!selectedId) return;
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const apiStatus = statusFilter === "approved" ? "allowed" : statusFilter;
      const query = apiStatus ? `?status=${encodeURIComponent(apiStatus)}` : "";
      const [filteredData, allData] = await Promise.all([
        apiFetch(`/api/agent-admin/access${query}`),
        apiFetch(`/api/agent-admin/access`),
      ]);
      setUsers(normalizeAccessUsers(filteredData));
      setAllUsers(normalizeAccessUsers(allData));
    } catch (err) {
      console.error(err);
      if (!silent) setError(err);
      toast.error(t("accessLoadError"));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [statusFilter, t, selectedId]);

  React.useEffect(() => {
    if (selectedId) {
      loadUsers();
    } else {
      setUsers([]);
      setLoading(false);
    }
  }, [selectedId, loadUsers]);

  const handleUpdateStatus = async (user: AgentAccessUser, nextStatus: "approved" | "rejected" | "revoked") => {
    if (processingId) return;
    setProcessingId(user.id);
    try {
      const apiStatus = nextStatus === "approved" ? "allowed" : nextStatus;
      await apiFetch(`/api/agent-admin/access/${user.id}`, {
        method: "POST",
        body: JSON.stringify({ status: apiStatus }),
      });
      toast.success(
        nextStatus === "approved"
          ? t("accessApprovedToastPre").replace("{name}", user.firstName)
          : t("accessRejectedToastPre").replace("{name}", user.firstName)
      );
      loadUsers(true);
    } catch (err) {
      console.error(err);
      toast.error(t("accessUpdateError"));
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <AgentConnectSelect />
        <Button
          variant="outline"
          size="sm"
          onClick={() => loadUsers()}
          className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl"
        >
          <RefreshCw className="w-4 h-4" />
          {t("accessBtnRefresh")}
        </Button>
      </div>

      {!selectedId ? (
        <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
          <p className="text-sm font-semibold">{t("agentConnectSelectAgent")}</p>
        </div>
      ) : (
        <>
          <Tabs
            tabs={[
              { id: "", label: t("accessTabAll"), icon: ShieldCheck },
              { id: "pending", label: t("accessTabPending"), icon: Clock },
              { id: "approved", label: t("accessTabAllowed"), icon: ShieldCheck },
              { id: "rejected", label: t("accessTabRejected"), icon: Ban },
              { id: "revoked", label: t("accessTabRevoked"), icon: Ban },
            ]}
            activeTab={statusFilter}
            onChange={setStatusFilter}
          />

          {error ? (
            <ErrorState errorType={getAgentErrorType(error)} onRetry={() => loadUsers()} />
          ) : (
            <DataTable<AgentAccessUser>
              columns={[
                {
                  key: "name",
                  header: t("accessThName"),
                  render: (row) => (
                    <span className="font-bold text-zinc-900">
                      {row.firstName} {row.lastName || ""}
                    </span>
                  ),
                },
                {
                  key: "username",
                  header: t("accessThUsername"),
                  render: (row) =>
                    row.username ? `@${row.username}` : <span className="text-zinc-400">{t("accessUsernameNone")}</span>,
                },
                {
                  key: "requestedAt",
                  header: t("accessThRequestedAt"),
                  render: (row) => format(row.requestedAt, "dd/MM/yyyy HH:mm"),
                },
                {
                  key: "status",
                  header: t("accessThStatus"),
                  render: (row) => (
                    <Badge
                      variant={
                        row.status === "approved"
                          ? "success"
                          : row.status === "rejected" || row.status === "revoked"
                          ? "danger"
                          : "warning"
                      }
                    >
                      {row.status === "approved"
                        ? t("accessStatusApproved")
                        : row.status === "rejected"
                        ? t("accessStatusRejected")
                        : row.status === "revoked"
                        ? t("accessStatusRevoked")
                        : t("accessStatusPending")}
                    </Badge>
                  ),
                },
                {
                  key: "decidedInfo",
                  header: t("accessThDecidedBy"),
                  render: (row) => {
                    const getDecidedByLabel = (decidedBy: string | null) => {
                      if (!decidedBy) return "-";
                      if (decidedBy.startsWith("tg-")) {
                        const tgId = decidedBy.slice(3);
                        const found = allUsers.find((u) => u.telegramId === tgId || u.id === tgId);
                        if (found) {
                          const fullName = [found.firstName, found.lastName].filter(Boolean).join(" ");
                          const usernamePart = found.username ? ` (@${found.username})` : "";
                          return fullName ? `${fullName}${usernamePart}` : `@${found.username || tgId}`;
                        }
                      }
                      return decidedBy;
                    };
                    const label = getDecidedByLabel(row.decidedBy);
                    return row.decidedBy ? (
                      <div className="text-xs space-y-0.5">
                        <span className="font-semibold text-zinc-700">{label}</span>
                        {row.decidedAt && (
                          <p className="text-[10px] text-zinc-400">{format(row.decidedAt, "dd/MM HH:mm")}</p>
                        )}
                      </div>
                    ) : (
                      <span className="text-zinc-400">-</span>
                    );
                  },
                },
                {
                  key: "actions",
                  header: t("accessThActions"),
                  align: "right",
                  render: (row) => (
                    <div className="flex items-center justify-end gap-2">
                      <RoleGate allowedRoles={["operator", "superadmin"]}>
                        {row.status !== "approved" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpdateStatus(row, "approved")}
                            disabled={processingId === row.id}
                            className="flex items-center gap-1 text-emerald-600 hover:text-emerald-700 cursor-pointer rounded-xl"
                          >
                            <UserCheck className="w-4 h-4" />
                            {t("accessBtnApprove")}
                          </Button>
                        )}
                        {row.status !== "rejected" && row.status !== "revoked" && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleUpdateStatus(row, row.status === "approved" ? "revoked" : "rejected")}
                            disabled={processingId === row.id}
                            className="flex items-center gap-1 text-[--color-danger] hover:text-red-700 cursor-pointer rounded-xl"
                          >
                            <UserX className="w-4 h-4" />
                            {row.status === "approved" ? t("accessBtnRevoke") : t("accessBtnReject")}
                          </Button>
                        )}
                      </RoleGate>
                    </div>
                  ),
                },
              ]}
              data={users}
              isLoading={loading}
              emptyText={t("accessEmpty")}
            />
          )}
        </>
      )}
    </div>
  );
}
