"use client";

import * as React from "react";
import { useAuth } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { toast } from "@/lib/store/toast-store";
import { apiFetch } from "@/lib/api/client";
import { Key, Lock, CheckCircle2, XCircle } from "lucide-react";

export default function ChangePasswordPage() {
  const { bootstrap } = useAuth();

  const [currentPassword, setCurrentPassword] = React.useState("");
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState("");

  // Password Policy checklist
  const meetsMinLength = newPassword.length >= 12;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);

  const isFormValid =
    meetsMinLength &&
    hasUppercase &&
    hasLowercase &&
    hasNumber &&
    hasSpecial &&
    newPassword === confirmPassword &&
    currentPassword.length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isFormValid || isLoading) return;

    setIsLoading(true);
    setErrorMsg("");

    try {
      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      toast.success("Đổi mật khẩu thành công!");
      // Reload profile to update `mustChangePassword` state
      await bootstrap();
      // Redirect will be handled automatically by AuthWrapper
    } catch (err) {
      console.error(err);
      if (err instanceof Error && "status" in err && err.status === 400) {
        setErrorMsg("Mật khẩu mới không đáp ứng chính sách bảo mật.");
      } else if (err instanceof Error && "status" in err && err.status === 401) {
        setErrorMsg("Mật khẩu hiện tại không chính xác.");
      } else {
        setErrorMsg("Không thể đổi mật khẩu. Vui lòng thử lại.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-[--color-surface-muted]">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden p-8 animate-fade-in-up">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-[--color-warning-soft] text-[--color-warning] p-3.5 rounded-2xl mb-4 shadow-sm">
            <Lock className="w-8 h-8" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
            Yêu cầu Đổi mật khẩu
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            Vui lòng thay đổi mật khẩu của bạn để kích hoạt tài khoản
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {errorMsg && (
            <div className="p-3.5 bg-[--color-danger-soft] border border-red-200 rounded-xl text-xs font-semibold text-[--color-danger] text-center leading-relaxed">
              {errorMsg}
            </div>
          )}

          <Field label="Mật khẩu hiện tại" icon={Key} required>
            <Input
              type="password"
              value={currentPassword}
              disabled={isLoading}
              placeholder="Nhập mật khẩu hiện tại..."
              className="h-11 rounded-xl bg-zinc-50/50"
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </Field>

          <Field label="Mật khẩu mới" icon={Key} required>
            <Input
              type="password"
              value={newPassword}
              disabled={isLoading}
              placeholder="Nhập mật khẩu mới..."
              className="h-11 rounded-xl bg-zinc-50/50"
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>

          <Field label="Xác nhận mật khẩu mới" icon={Key} required>
            <Input
              type="password"
              value={confirmPassword}
              disabled={isLoading}
              placeholder="Nhập lại mật khẩu mới..."
              className="h-11 rounded-xl bg-zinc-50/50"
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>

          {/* Password policy checklist */}
          <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-200/50 space-y-2 text-xs">
            <p className="font-bold text-zinc-700 mb-1">Chính sách mật khẩu:</p>
            <div className="grid grid-cols-1 gap-1.5 font-semibold">
              <div className="flex items-center gap-1.5">
                {meetsMinLength ? (
                  <CheckCircle2 className="w-4 h-4 text-[--color-success]" />
                ) : (
                  <XCircle className="w-4 h-4 text-zinc-300" />
                )}
                <span className={meetsMinLength ? "text-[--color-success]" : "text-zinc-500"}>
                  Độ dài tối thiểu 12 ký tự
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasUppercase ? (
                  <CheckCircle2 className="w-4 h-4 text-[--color-success]" />
                ) : (
                  <XCircle className="w-4 h-4 text-zinc-300" />
                )}
                <span className={hasUppercase ? "text-[--color-success]" : "text-zinc-500"}>
                  Có ít nhất 1 chữ hoa (A-Z)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasLowercase ? (
                  <CheckCircle2 className="w-4 h-4 text-[--color-success]" />
                ) : (
                  <XCircle className="w-4 h-4 text-zinc-300" />
                )}
                <span className={hasLowercase ? "text-[--color-success]" : "text-zinc-500"}>
                  Có ít nhất 1 chữ thường (a-z)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasNumber ? (
                  <CheckCircle2 className="w-4 h-4 text-[--color-success]" />
                ) : (
                  <XCircle className="w-4 h-4 text-zinc-300" />
                )}
                <span className={hasNumber ? "text-[--color-success]" : "text-zinc-500"}>
                  Có ít nhất 1 chữ số (0-9)
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasSpecial ? (
                  <CheckCircle2 className="w-4 h-4 text-[--color-success]" />
                ) : (
                  <XCircle className="w-4 h-4 text-zinc-300" />
                )}
                <span className={hasSpecial ? "text-[--color-success]" : "text-zinc-500"}>
                  Có ít nhất 1 ký tự đặc biệt (!@#...)
                </span>
              </div>
              <div className="flex items-center gap-1.5 border-t border-zinc-200/50 pt-1.5 mt-1.5">
                {newPassword && confirmPassword && newPassword === confirmPassword ? (
                  <CheckCircle2 className="w-4 h-4 text-[--color-success]" />
                ) : (
                  <XCircle className="w-4 h-4 text-zinc-300" />
                )}
                <span
                  className={
                    newPassword && confirmPassword && newPassword === confirmPassword
                      ? "text-[--color-success]"
                      : "text-zinc-500"
                  }
                >
                  Xác nhận mật khẩu trùng khớp
                </span>
              </div>
            </div>
          </div>

          <Button
            type="submit"
            variant="primary"
            disabled={!isFormValid || isLoading}
            isLoading={isLoading}
            className="w-full h-11 hover:opacity-90 active:scale-[0.98] text-white rounded-xl font-bold transition-all cursor-pointer"
          >
            Đổi mật khẩu & Tiếp tục
          </Button>
        </form>
      </div>
    </div>
  );
}
