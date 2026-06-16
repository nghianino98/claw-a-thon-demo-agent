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
  User,
  Clock,
  Plus,
  Trash2,
  Lock,
  Database,
  Terminal,
} from "lucide-react";

interface Session {
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  lastSeenAt: number;
  ip: string | null;
  userAgent: string | null;
}

interface Credential {
  id: number;
  source: "confluence" | "jira" | "gitlab";
  label: string;
  username: string;
  createdAt: number;
  updatedAt: number;
  lastUsedAt: number | null;
  revoked: number;
}

interface Token {
  id: number;
  name: string;
  expiresAt: number;
  lastUsedAt: number | null;
  createdAt: number;
}

export default function AccountPage() {
  const router = useRouter();
  const { user, authMode } = useAuth();
  const [activeTab, setActiveTab] = React.useState("profile");

  // State lists
  const [sessions, setSessions] = React.useState<Session[]>([]);
  const [credentials, setCredentials] = React.useState<Credential[]>([]);
  const [tokens, setTokens] = React.useState<Token[]>([]);

  // Loading states
  const [loadingSessions, setLoadingSessions] = React.useState(false);
  const [loadingCredentials, setLoadingCredentials] = React.useState(false);
  const [loadingTokens, setLoadingTokens] = React.useState(false);

  // Modals & dialogs
  const [isAddCredOpen, setIsAddCredOpen] = React.useState(false);
  const [isCreateTokenOpen, setIsCreateTokenOpen] = React.useState(false);
  const [newPlaintextToken, setNewPlaintextToken] = React.useState("");
  const [deleteConfirm, setDeleteConfirm] = React.useState<{
    isOpen: boolean;
    type: "session" | "credential" | "token";
    id: string | number;
    title: string;
    message: string;
  }>({
    isOpen: false,
    type: "session",
    id: "",
    title: "",
    message: "",
  });

  // Form states
  const [credSource, setCredSource] = React.useState<"confluence" | "jira" | "gitlab">("confluence");
  const [credLabel, setCredLabel] = React.useState("default");
  const [credUsername, setCredUsername] = React.useState("");
  const [credToken, setCredToken] = React.useState("");
  const [credSubmitting, setCredSubmitting] = React.useState(false);

  const [tokenName, setTokenName] = React.useState("");
  const [tokenDays, setTokenDays] = React.useState("30");
  const [tokenSubmitting, setTokenSubmitting] = React.useState(false);

  // Redirect if local mode
  React.useEffect(() => {
    if (authMode === "off") {
      router.replace("/knowledge-base");
    }
  }, [authMode, router]);

  // Loaders
  const loadSessions = React.useCallback(async () => {
    setLoadingSessions(true);
    try {
      const data = await apiFetch<{ sessions: Session[] }>("/api/sessions");
      setSessions(data.sessions || []);
    } catch (err) {
      console.error(err);
      toast.error("Không thể tải danh sách phiên hoạt động.");
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  const loadCredentials = React.useCallback(async () => {
    setLoadingCredentials(true);
    try {
      const data = await apiFetch<{ credentials: Credential[] }>("/api/credentials");
      setCredentials(data.credentials || []);
    } catch (err) {
      console.error(err);
      toast.error("Không thể tải thông tin xác thực.");
    } finally {
      setLoadingCredentials(false);
    }
  }, []);

  const loadTokens = React.useCallback(async () => {
    setLoadingTokens(true);
    try {
      const data = await apiFetch<{ tokens: Token[] }>("/api/tokens");
      setTokens(data.tokens || []);
    } catch (err) {
      console.error(err);
      toast.error("Không thể tải danh sách Personal Tokens.");
    } finally {
      setLoadingTokens(false);
    }
  }, []);

  // Sync tab loading
  React.useEffect(() => {
    if (authMode !== "required") return;
    if (activeTab === "sessions") loadSessions();
    if (activeTab === "credentials") loadCredentials();
    if (activeTab === "tokens") loadTokens();
  }, [activeTab, authMode, loadSessions, loadCredentials, loadTokens]);

  const handleDeleteConfirm = async () => {
    const { type, id } = deleteConfirm;
    try {
      if (type === "session") {
        await apiFetch(`/api/sessions/${id}`, { method: "DELETE" });
        toast.success("Đã thu hồi phiên hoạt động thành công!");
        loadSessions();
      } else if (type === "credential") {
        await apiFetch(`/api/credentials/${id}`, { method: "DELETE" });
        toast.success("Đã xóa thông tin xác thực thành công!");
        loadCredentials();
      } else if (type === "token") {
        await apiFetch(`/api/tokens/${id}`, { method: "DELETE" });
        toast.success("Đã hủy bỏ Personal Token thành công!");
        loadTokens();
      }
    } catch (err) {
      console.error(err);
      toast.error("Đã xảy ra lỗi khi thực hiện thao tác.");
    }
  };

  const handleAddCredential = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!credUsername.trim() || !credToken.trim() || credSubmitting) return;

    setCredSubmitting(true);
    try {
      await apiFetch("/api/credentials", {
        method: "POST",
        body: JSON.stringify({
          source: credSource,
          label: credLabel.trim() || "default",
          username: credUsername.trim(),
          token: credToken.trim(),
        }),
      });
      toast.success("Đã lưu thông tin xác thực thành công!");
      setIsAddCredOpen(false);
      // Reset form
      setCredUsername("");
      setCredToken("");
      setCredLabel("default");
      loadCredentials();
    } catch (err) {
      console.error(err);
      toast.error("Không thể lưu credentials. Vui lòng kiểm tra lại.");
    } finally {
      setCredSubmitting(false);
    }
  };

  const handleCreateToken = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenName.trim() || tokenSubmitting) return;

    setTokenSubmitting(true);
    try {
      const expiryDate = Date.now() + parseInt(tokenDays) * 24 * 3600 * 1000;
      const data = await apiFetch<{ token: string }>("/api/tokens", {
        method: "POST",
        body: JSON.stringify({ name: tokenName.trim(), expiresAt: expiryDate }),
      });
      setNewPlaintextToken(data.token);
      setTokenName("");
      loadTokens();
    } catch (err) {
      console.error(err);
      toast.error("Không thể tạo Personal Token.");
    } finally {
      setTokenSubmitting(false);
    }
  };

  // UI Tabs Definition
  const tabs = [
    { id: "profile", label: "Hồ sơ & Bảo mật", icon: User },
    { id: "credentials", label: "Thông tin xác thực", icon: Database },
    { id: "tokens", label: "Personal Access Tokens", icon: Terminal },
    { id: "sessions", label: "Phiên hoạt động", icon: Clock },
  ];

  return (
    <PageShell>
      <PageHeader
        title="Tài khoản của tôi"
        subtitle="Quản lý thông tin xác thực cá nhân, bảo mật và các phiên đăng nhập."
      />

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {/* Profile & Security Tab */}
      {activeTab === "profile" && (
        <div className="space-y-6 max-w-2xl bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-base font-bold text-zinc-900 flex items-center gap-2 border-b border-zinc-100 pb-3">
            <Lock className="w-5 h-5 text-[--color-primary]" />
            Bảo mật tài khoản
          </h3>

          <div className="space-y-4">
            <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl border border-zinc-200/50">
              <div>
                <h4 className="font-bold text-sm text-zinc-800">Mật khẩu</h4>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Đổi mật khẩu định kỳ để nâng cao bảo mật.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push("/change-password")}
                className="cursor-pointer font-semibold rounded-xl"
              >
                Đổi mật khẩu
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-xl border border-zinc-200/50">
              <div>
                <h4 className="font-bold text-sm text-zinc-800 flex items-center gap-1.5">
                  Xác thực 2 bước (2FA)
                  {user?.hasTotp ? (
                    <Badge variant="success">Bật</Badge>
                  ) : (
                    <Badge variant="warning">Tắt</Badge>
                  )}
                </h4>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Kích hoạt mã OTP qua ứng dụng Authenticator khi đăng nhập.
                </p>
              </div>
              {!user?.hasTotp && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => router.push("/setup-2fa")}
                  className="cursor-pointer font-bold rounded-xl"
                >
                  Kích hoạt 2FA
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Credentials Tab */}
      {activeTab === "credentials" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              onClick={() => setIsAddCredOpen(true)}
              className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl"
            >
              <Plus className="w-4 h-4" />
              Thêm credential
            </Button>
          </div>

          <DataTable<Credential>
            columns={[
              {
                key: "source",
                header: "Nền tảng",
                render: (row) => (
                  <Badge
                    variant={
                      row.source === "confluence"
                        ? "default"
                        : row.source === "gitlab"
                        ? "warning"
                        : "secondary"
                    }
                  >
                    {row.source}
                  </Badge>
                ),
              },
              { key: "label", header: "Nhãn (Label)" },
              { key: "username", header: "Tên đăng nhập / Email" },
              {
                key: "createdAt",
                header: "Ngày tạo",
                render: (row) => format(row.createdAt, "dd/MM/yyyy HH:mm"),
              },
              {
                key: "lastUsedAt",
                header: "Sử dụng lần cuối",
                render: (row) =>
                  row.lastUsedAt ? format(row.lastUsedAt, "dd/MM/yyyy HH:mm") : "Chưa dùng",
              },
              {
                key: "actions",
                header: "Thao tác",
                align: "right",
                render: (row) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setDeleteConfirm({
                        isOpen: true,
                        type: "credential",
                        id: row.id,
                        title: "Xóa Credential Vault",
                        message: `Bạn có chắc chắn muốn xóa thông tin xác thực ${row.source} (${row.username})? Task cũ sử dụng credential này sẽ thất bại khi chạy.`,
                      })
                    }
                    className="text-zinc-400 hover:text-[--color-danger] cursor-pointer rounded-xl"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                ),
              },
            ]}
            data={credentials}
            isLoading={loadingCredentials}
            emptyText="Chưa có thông tin xác thực nào được thiết lập trong vault."
          />
        </div>
      )}

      {/* Personal Access Tokens Tab */}
      {activeTab === "tokens" && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setNewPlaintextToken("");
                setIsCreateTokenOpen(true);
              }}
              className="flex items-center gap-1.5 font-bold cursor-pointer rounded-xl"
            >
              <Plus className="w-4 h-4" />
              Tạo Token mới
            </Button>
          </div>

          <DataTable<Token>
            columns={[
              { key: "name", header: "Tên Token" },
              {
                key: "createdAt",
                header: "Ngày tạo",
                render: (row) => format(row.createdAt, "dd/MM/yyyy HH:mm"),
              },
              {
                key: "expiresAt",
                header: "Hạn dùng",
                render: (row) => format(row.expiresAt, "dd/MM/yyyy HH:mm"),
              },
              {
                key: "lastUsedAt",
                header: "Dùng lần cuối",
                render: (row) =>
                  row.lastUsedAt ? format(row.lastUsedAt, "dd/MM/yyyy HH:mm") : "Chưa dùng",
              },
              {
                key: "actions",
                header: "Thao tác",
                align: "right",
                render: (row) => (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      setDeleteConfirm({
                        isOpen: true,
                        type: "token",
                        id: row.id,
                        title: "Thu hồi Personal Token",
                        message: `Bạn có chắc chắn muốn hủy bỏ token "${row.name}"? Mọi công cụ CI/CD hay API client bên ngoài sử dụng token này sẽ không thể xác thực nữa.`,
                      })
                    }
                    className="text-zinc-400 hover:text-[--color-danger] cursor-pointer rounded-xl"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                ),
              },
            ]}
            data={tokens}
            isLoading={loadingTokens}
            emptyText="Chưa có Personal Access Token nào được tạo."
          />
        </div>
      )}

      {/* Active Sessions Tab */}
      {activeTab === "sessions" && (
        <div className="space-y-4">
          <DataTable<Session>
            columns={[
              {
                key: "ip",
                header: "Địa chỉ IP",
                render: (row) => row.ip || "Không rõ IP",
              },
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
                    onClick={() =>
                      setDeleteConfirm({
                        isOpen: true,
                        type: "session",
                        id: row.tokenHash,
                        title: "Đóng phiên làm việc",
                        message: "Bạn có chắc chắn muốn kết thúc phiên đăng nhập này? Thiết bị tương ứng sẽ lập tức bị đăng xuất và yêu cầu đăng nhập lại.",
                      })
                    }
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

      {/* Modal: Add Credential */}
      <Modal
        isOpen={isAddCredOpen}
        onClose={() => setIsAddCredOpen(false)}
        title="Thêm Thông tin xác thực mới"
        footer={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsAddCredOpen(false)}
              disabled={credSubmitting}
              className="rounded-xl font-semibold"
            >
              Hủy
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddCredential}
              isLoading={credSubmitting}
              className="rounded-xl font-bold"
            >
              Lưu Credential
            </Button>
          </>
        }
      >
        <form onSubmit={handleAddCredential} className="space-y-4">
          <Field label="Nền tảng tri thức" required>
            <Select
              value={credSource}
              onChange={(e) => setCredSource(e.target.value as Credential["source"])}
              options={[
                { value: "confluence", label: "Confluence" },
                { value: "jira", label: "Jira" },
                { value: "gitlab", label: "GitLab" },
              ]}
            />
          </Field>

          <Field
            label="Nhãn (Label)"
            hint="Để phân biệt nếu bạn có nhiều tài khoản trên cùng nền tảng. Ví dụ: default"
            required
          >
            <Input
              type="text"
              value={credLabel}
              placeholder="default"
              onChange={(e) => setCredLabel(e.target.value)}
              className="h-10 rounded-xl"
            />
          </Field>

          <Field label="Tên đăng nhập / Email" required>
            <Input
              type="text"
              value={credUsername}
              placeholder="Nhập tên đăng nhập hoặc email..."
              onChange={(e) => setCredUsername(e.target.value)}
              className="h-10 rounded-xl"
            />
          </Field>

          <Field label="API Key / Private Token" required>
            <Input
              type="password"
              value={credToken}
              placeholder="Nhập mã token bí mật..."
              onChange={(e) => setCredToken(e.target.value)}
              className="h-10 rounded-xl"
            />
          </Field>
        </form>
      </Modal>

      {/* Modal: Create Personal Token */}
      <Modal
        isOpen={isCreateTokenOpen}
        onClose={() => {
          setIsCreateTokenOpen(false);
          setNewPlaintextToken("");
        }}
        title="Tạo Personal Access Token"
        footer={
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              setIsCreateTokenOpen(false);
              setNewPlaintextToken("");
            }}
            className="rounded-xl font-bold"
          >
            Đóng
          </Button>
        }
      >
        {!newPlaintextToken ? (
          <form onSubmit={handleCreateToken} className="space-y-4">
            <Field label="Tên gợi nhớ (Name)" required>
              <Input
                type="text"
                value={tokenName}
                placeholder="Ví dụ: ci-cd-sync-token"
                onChange={(e) => setTokenName(e.target.value)}
                className="h-10 rounded-xl"
              />
            </Field>

            <Field label="Thời gian hiệu lực" required>
              <Select
                value={tokenDays}
                onChange={(e) => setTokenDays(e.target.value)}
                options={[
                  { value: "7", label: "7 ngày" },
                  { value: "30", label: "30 ngày" },
                  { value: "60", label: "60 ngày" },
                  { value: "90", label: "90 ngày (Tối đa)" },
                ]}
              />
            </Field>

            <Button
              variant="primary"
              size="sm"
              onClick={handleCreateToken}
              isLoading={tokenSubmitting}
              className="w-full h-10 font-bold rounded-xl cursor-pointer"
            >
              Tạo Token
            </Button>
          </form>
        ) : (
          <div className="space-y-4 animate-fade-in-up">
            <div className="p-3.5 bg-[--color-warning-soft] border border-amber-200 rounded-xl text-xs font-semibold text-[--color-warning] leading-relaxed">
              **Lưu ý cực kỳ quan trọng:** Đây là lần DUY NHẤT bạn có thể nhìn thấy mã token trần
              này. Vui lòng copy và lưu trữ nó ở nơi an toàn.
            </div>
            <Field label="Mã Token của bạn">
              <CopyField value={newPlaintextToken} />
            </Field>
          </div>
        )}
      </Modal>

      {/* Delete/Revoke Confirm Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirm.isOpen}
        onClose={() => setDeleteConfirm((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleDeleteConfirm}
        title={deleteConfirm.title}
        message={deleteConfirm.message}
        isDestructive
      />
    </PageShell>
  );
}
