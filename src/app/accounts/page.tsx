"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store/auth-store";
import { PageShell, PageHeader } from "@/components/ui/page-shell";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { CopyField } from "@/components/ui/copy-field";
import { toast } from "@/lib/store/toast-store";
import { apiFetch } from "@/lib/api/client";
import { format } from "date-fns";
import {
  Users,
  Clock,
  Plus,
  UserCheck,
  UserMinus,
  KeyRound,
  QrCode,
  Trash2,
} from "lucide-react";

interface AdminUser {
  id: number;
  username: string;
  role: "superadmin" | "operator" | "viewer";
  status: "active" | "disabled";
  hasTotp: boolean;
  lastLoginAt: number | null;
  lastLoginIp: string | null;
  createdAt: number;
}

interface Session {
  tokenHash: string;
  userId: number;
  username: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string | null;
  userAgent: string | null;
}

export default function AccountsPage() {
  const router = useRouter();
  const { user, authMode } = useAuth();
  const [activeTab, setActiveTab] = React.useState("users");

  // State lists
  const [users, setUsers] = React.useState<AdminUser[]>([]);
  const [sessions, setSessions] = React.useState<Session[]>([]);

  // Loadings
  const [loadingUsers, setLoadingUsers] = React.useState(false);
  const [loadingSessions, setLoadingSessions] = React.useState(false);

  // Modal controls
  const [isAddUserOpen, setIsAddUserOpen] = React.useState(false);
  const [tempPassword, setTempPassword] = React.useState("");

  // Form states (Add User)
  const [newUsername, setNewUsername] = React.useState("");
  const [newRole, setNewRole] = React.useState<"superadmin" | "operator" | "viewer">("operator");
  const [newPassword, setNewPassword] = React.useState("");
  const [userSubmitting, setUserSubmitting] = React.useState(false);

  // Reset actions
  const [resetPwResult, setResetPwResult] = React.useState("");
  const [isResetPwOpen, setIsResetPwOpen] = React.useState(false);

  // Confirm dialogs
  const [confirmAction, setConfirmAction] = React.useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void | Promise<void>;
  }>({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => {},
  });

  // Redirect if not superadmin
  React.useEffect(() => {
    if (authMode === "off") {
      router.replace("/knowledge-base");
      return;
    }
    if (user && user.role !== "superadmin") {
      router.replace("/knowledge-base");
      toast.error("Bạn không có quyền truy cập trang quản trị tài khoản.");
    }
  }, [authMode, user, router]);

  const loadUsers = React.useCallback(async () => {
    setLoadingUsers(true);
    try {
      const data = await apiFetch<{ users: AdminUser[] }>("/api/accounts");
      setUsers(data.users || []);
    } catch (err) {
      console.error(err);
      toast.error("Không thể tải danh sách tài khoản.");
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  const loadSessions = React.useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await apiFetch<{ sessions: Session[] }>("/api/sessions?all=1");
      setSessions(data.sessions || []);
    } catch (err) {
      console.error(err);
      toast.error("Không thể tải toàn bộ danh sách phiên hoạt động.");
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  React.useEffect(() => {
    if (authMode !== "required" || (user && user.role !== "superadmin")) return;
    if (activeTab === "users") loadUsers();
    if (activeTab === "sessions") loadSessions();
  }, [activeTab, authMode, user, loadUsers, loadSessions]);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || userSubmitting) return;

    setUserSubmitting(true);
    try {
      const data = await apiFetch<{ temporaryPassword?: string }>("/api/accounts", {
        method: "POST",
        body: JSON.stringify({
          username: newUsername.trim(),
          role: newRole,
          password: newPassword.trim() || undefined,
        }),
      });

      toast.success("Tạo tài khoản thành công!");
      if (data.temporaryPassword) {
        setTempPassword(data.temporaryPassword);
      } else {
        setIsAddUserOpen(false);
        setNewUsername("");
        setNewPassword("");
        setNewRole("operator");
      }
      loadUsers();
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Không thể tạo tài khoản.");
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleUserRoleChange = async (userId: number, role: "superadmin" | "operator" | "viewer") => {
    try {
      await apiFetch(`/api/accounts/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      toast.success("Cập nhật quyền hạn thành công!");
      loadUsers();
    } catch (err) {
      console.error(err);
      toast.error("Không thể cập nhật quyền hạn.");
    }
  };

  const handleUserStatusChange = (userId: number, username: string, currentStatus: "active" | "disabled") => {
    const nextStatus = currentStatus === "active" ? "disabled" : "active";
    setConfirmAction({
      isOpen: true,
      title: nextStatus === "disabled" ? "Vô hiệu hóa tài khoản" : "Kích hoạt tài khoản",
      message: `Bạn có chắc chắn muốn ${
        nextStatus === "disabled" ? "vô hiệu hóa" : "kích hoạt"
      } tài khoản "${username}"? Phiên làm việc hiện tại của tài khoản sẽ bị hủy bỏ nếu vô hiệu hóa.`,
      onConfirm: async () => {
        await apiFetch(`/api/accounts/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: nextStatus }),
        });
        toast.success(`${nextStatus === "disabled" ? "Vô hiệu hóa" : "Kích hoạt"} thành công!`);
        loadUsers();
      },
    });
  };

  const handleResetTotp = (userId: number, username: string) => {
    setConfirmAction({
      isOpen: true,
      title: "Đặt lại xác thực 2 bước (2FA)",
      message: `Bạn có chắc chắn muốn tắt 2FA của người dùng "${username}"? Họ sẽ cần thực hiện quét mã QR 2FA ở lần đăng nhập tiếp theo.`,
      onConfirm: async () => {
        await apiFetch(`/api/accounts/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ resetTotp: true }),
        });
        toast.success("Đã đặt lại 2FA thành công!");
        loadUsers();
      },
    });
  };

  const handleResetPassword = (userId: number, username: string) => {
    setConfirmAction({
      isOpen: true,
      title: "Đặt lại mật khẩu",
      message: `Bạn có chắc chắn muốn đặt lại mật khẩu cho tài khoản "${username}"? Hệ thống sẽ tạo một mật khẩu tạm thời mới và yêu cầu đổi ở lần đăng nhập tiếp theo.`,
      onConfirm: async () => {
        const data = await apiFetch<{ temporaryPassword: string }>(`/api/accounts/${userId}`, {
          method: "PATCH",
          body: JSON.stringify({ resetPassword: true }),
        });
        setResetPwResult(data.temporaryPassword);
        setIsResetPwOpen(true);
        loadUsers();
      },
    });
  };

  const handleRevokeSession = (tokenHash: string, username: string) => {
    setConfirmAction({
      isOpen: true,
      title: "Thu hồi phiên làm việc",
      message: `Bạn có chắc chắn muốn hủy phiên đăng nhập của người dùng "${username}"? Thiết bị tương ứng sẽ lập tức bị đăng xuất.`,
      onConfirm: async () => {
        await apiFetch(`/api/sessions/${tokenHash}`, { method: "DELETE" });
        toast.success("Thu hồi phiên đăng nhập thành công!");
        loadSessions();
      },
    });
  };

  const tabs = [
    { id: "users", label: "Danh sách tài khoản", icon: Users },
    { id: "sessions", label: "Tất cả phiên hoạt động", icon: Clock },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Quản trị Hệ thống"
        subtitle="Quản lý tài khoản người dùng, phân quyền vai trò và kiểm soát phiên truy cập."
      />

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setTempPassword("");
                setIsAddUserOpen(true);
              }}
              className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl"
            >
              <Plus className="w-4 h-4" />
              Thêm User mới
            </Button>
          </div>

          <DataTable<AdminUser>
            columns={[
              { key: "username", header: "Tên đăng nhập" },
              {
                key: "role",
                header: "Quyền hạn (Role)",
                render: (row) => (
                  <Select
                    value={row.role}
                    disabled={row.id === user?.id} // Cannot change own role
                    onChange={(e) => handleUserRoleChange(row.id, e.target.value as AdminUser["role"])}
                    className="h-8 py-0.5 text-xs w-36 rounded-lg font-bold border-zinc-200"
                  >
                    <option value="superadmin">Superadmin</option>
                    <option value="operator">Operator</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                ),
              },
              {
                key: "status",
                header: "Trạng thái",
                render: (row) => (
                  <Badge variant={row.status === "active" ? "success" : "danger"}>
                    {row.status === "active" ? "Kích hoạt" : "Khóa"}
                  </Badge>
                ),
              },
              {
                key: "hasTotp",
                header: "Mã 2FA",
                render: (row) => (
                  <Badge variant={row.hasTotp ? "success" : "outline"}>
                    {row.hasTotp ? "Đã bật" : "Chưa bật"}
                  </Badge>
                ),
              },
              {
                key: "lastLoginAt",
                header: "Đăng nhập cuối",
                render: (row) =>
                  row.lastLoginAt
                    ? `${format(row.lastLoginAt, "dd/MM/yyyy HH:mm")} (${
                        row.lastLoginIp || "Không rõ IP"
                      })`
                    : "Chưa từng đăng nhập",
              },
              {
                key: "actions",
                header: "Hành động hệ thống",
                align: "right",
                render: (row) => (
                  <div className="flex items-center justify-end gap-1.5">
                    {/* Toggle status */}
                    {row.id !== user?.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleUserStatusChange(row.id, row.username, row.status)}
                        className="p-1.5 cursor-pointer text-zinc-500 rounded-lg hover:bg-zinc-100 hover:text-zinc-900"
                        title={row.status === "active" ? "Khóa tài khoản" : "Mở tài khoản"}
                      >
                        {row.status === "active" ? (
                          <UserMinus className="w-4 h-4 text-[--color-danger]" />
                        ) : (
                          <UserCheck className="w-4 h-4 text-[--color-success]" />
                        )}
                      </Button>
                    ) : null}

                    {/* Reset 2FA */}
                    {row.hasTotp ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleResetTotp(row.id, row.username)}
                        className="p-1.5 cursor-pointer text-zinc-500 rounded-lg hover:bg-zinc-100 hover:text-zinc-900"
                        title="Tắt 2FA"
                      >
                        <QrCode className="w-4 h-4" />
                      </Button>
                    ) : null}

                    {/* Reset Password */}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleResetPassword(row.id, row.username)}
                      className="p-1.5 cursor-pointer text-zinc-500 rounded-lg hover:bg-zinc-100 hover:text-zinc-900"
                      title="Đặt lại mật khẩu"
                    >
                      <KeyRound className="w-4 h-4" />
                    </Button>
                  </div>
                ),
              },
            ]}
            data={users}
            isLoading={loadingUsers}
            emptyText="Không có người dùng nào."
          />
        </div>
      )}

      {activeTab === "sessions" && (
        <div className="space-y-4">
          <DataTable<Session>
            columns={[
              { key: "username", header: "Người dùng", render: (row) => <span className="font-bold">{row.username}</span> },
              { key: "ip", header: "Địa chỉ IP", render: (row) => row.ip || "Không rõ IP" },
              {
                key: "userAgent",
                header: "Thiết bị / Trình duyệt",
                render: (row) => (
                  <div className="max-w-md truncate text-xs font-mono" title={row.userAgent || ""}>
                    {row.userAgent || "Không rõ thiết bị"}
                  </div>
                ),
              },
              {
                key: "createdAt",
                header: "Đăng nhập lúc",
                render: (row) => format(row.createdAt, "dd/MM/yyyy HH:mm"),
              },
              {
                key: "lastSeenAt",
                header: "Hoạt động cuối",
                render: (row) => format(row.lastSeenAt, "dd/MM/yyyy HH:mm"),
              },
              {
                key: "actions",
                header: "Thao tác",
                align: "right",
                render: (row) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRevokeSession(row.tokenHash, row.username)}
                    className="text-zinc-400 hover:text-[--color-danger] cursor-pointer rounded-xl"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                ),
              },
            ]}
            data={sessions}
            isLoading={loadingSessions}
            emptyText="Không tìm thấy phiên làm việc nào."
          />
        </div>
      )}

      {/* Modal: Add User */}
      <Modal
        isOpen={isAddUserOpen}
        onClose={() => {
          setIsAddUserOpen(false);
          setTempPassword("");
          setNewUsername("");
          setNewPassword("");
          setNewRole("operator");
        }}
        title="Tạo Tài khoản quản trị mới"
        footer={
          <Button
            variant={tempPassword ? "default" : "outline"}
            size="sm"
            onClick={() => {
              setIsAddUserOpen(false);
              setTempPassword("");
              setNewUsername("");
              setNewPassword("");
              setNewRole("operator");
            }}
            disabled={userSubmitting}
            className="rounded-xl font-semibold"
          >
            {tempPassword ? "Đóng" : "Hủy"}
          </Button>
        }
      >
        {!tempPassword ? (
          <form onSubmit={handleAddUser} className="space-y-4">
            <Field label="Tên đăng nhập" required>
              <Input
                type="text"
                value={newUsername}
                placeholder="Ví dụ: operator2"
                onChange={(e) => setNewUsername(e.target.value)}
                className="h-10 rounded-xl"
              />
            </Field>

            <Field label="Vai trò (Role)" required>
              <Select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value as AdminUser["role"])}
                options={[
                  { value: "viewer", label: "Viewer (Chỉ xem)" },
                  { value: "operator", label: "Operator (Vận hành)" },
                  { value: "superadmin", label: "Superadmin (Toàn quyền)" },
                ]}
              />
            </Field>

            <Field
              label="Mật khẩu tạm thời (Không bắt buộc)"
              hint="Bỏ trống nếu bạn muốn hệ thống tự động sinh mật khẩu ngẫu nhiên."
            >
              <Input
                type="password"
                value={newPassword}
                placeholder="Tối thiểu 12 ký tự..."
                onChange={(e) => setNewPassword(e.target.value)}
                className="h-10 rounded-xl"
              />
            </Field>

            <Button
              variant="primary"
              size="sm"
              onClick={handleAddUser}
              isLoading={userSubmitting}
              className="w-full h-10 font-bold rounded-xl cursor-pointer"
            >
              Tạo tài khoản
            </Button>
          </form>
        ) : (
          <div className="space-y-4 animate-fade-in-up">
            <div className="p-3.5 bg-[--color-warning-soft] border border-amber-200 rounded-xl text-xs font-semibold text-[--color-warning] leading-relaxed">
              **Lưu ý:** Tài khoản đã được tạo thành công. Đây là lần duy nhất hiển thị mật khẩu tạm
              thời này. Người dùng sẽ bắt buộc phải đổi mật khẩu ở lần đăng nhập tiếp theo.
            </div>
            <Field label="Mật khẩu tạm thời">
              <CopyField value={tempPassword} />
            </Field>
          </div>
        )}
      </Modal>

      {/* Modal: Reset PW Result */}
      <Modal
        isOpen={isResetPwOpen}
        onClose={() => {
          setIsResetPwOpen(false);
          setResetPwResult("");
        }}
        title="Đặt lại Mật khẩu thành công"
        footer={
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setIsResetPwOpen(false);
              setResetPwResult("");
            }}
            className="rounded-xl font-bold"
          >
            Đóng
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="p-3.5 bg-[--color-warning-soft] border border-amber-200 rounded-xl text-xs font-semibold text-[--color-warning] leading-relaxed">
            Mật khẩu mới đã được đặt thành công. Người dùng cần sử dụng mật khẩu tạm thời này để đăng
            nhập và đổi lại mật khẩu của mình.
          </div>
          <Field label="Mật khẩu tạm thời mới">
            <CopyField value={resetPwResult} />
          </Field>
        </div>
      </Modal>

      {/* Confirm Action Dialog */}
      <ConfirmDialog
        isOpen={confirmAction.isOpen}
        onClose={() => setConfirmAction((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={confirmAction.onConfirm}
        title={confirmAction.title}
        message={confirmAction.message}
        isDestructive
      />
    </PageShell>
  );
}
