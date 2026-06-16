"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { toast } from "@/lib/store/toast-store";
import { Workflow, Key, User, ShieldCheck } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, authMode, authenticated } = useAuth();

  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [requiresOtp, setRequiresOtp] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [errorMessage, setErrorMessage] = React.useState("");
  const [lockoutTimeLeft, setLockoutTimeLeft] = React.useState(0);

  // If already authenticated and not required to change password, redirect to home
  React.useEffect(() => {
    if (authMode === "off" || authenticated) {
      router.replace("/knowledge-base");
    }
  }, [authMode, authenticated, router]);

  // Lockout countdown timer
  React.useEffect(() => {
    if (lockoutTimeLeft <= 0) return;
    const interval = setInterval(() => {
      setLockoutTimeLeft((prev) => prev - 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [lockoutTimeLeft]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    if (!username.trim() || !password) {
      setErrorMessage("Vui lòng điền tên đăng nhập và mật khẩu.");
      return;
    }

    if (requiresOtp && !otp.trim()) {
      setErrorMessage("Vui lòng nhập mã OTP 6 số.");
      return;
    }

    setIsLoading(true);
    setErrorMessage("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, otp: otp || undefined }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 423) {
          // Locked account
          const timeLeft = Math.ceil((data.lockedUntil - Date.now()) / 1000);
          setLockoutTimeLeft(timeLeft > 0 ? timeLeft : 900);
          setErrorMessage("Tài khoản đã bị tạm khóa do nhập sai nhiều lần.");
        } else if (res.status === 429) {
          setErrorMessage("Quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.");
        } else {
          // 401
          setErrorMessage("Sai thông tin đăng nhập hoặc tài khoản bị vô hiệu hóa.");
        }
        setIsLoading(false);
        return;
      }

      if (data.requiresOtp) {
        setRequiresOtp(true);
        setIsLoading(false);
        toast.info("Yêu cầu nhập mã xác thực OTP 6 số.");
        return;
      }

      if (data.success) {
        setAuth({
          authenticated: true,
          authMode: data.authMode || authMode,
          user: data.user,
          csrfToken: data.csrfToken,
        });

        toast.success("Đăng nhập thành công!");

        if (data.nextStep === "change_password") {
          router.replace("/change-password");
        } else if (data.nextStep === "setup_2fa") {
          router.replace("/setup-2fa");
        } else {
          router.replace("/knowledge-base");
        }
      }
    } catch (err) {
      console.error(err);
      setErrorMessage("Lỗi kết nối hệ thống. Vui lòng thử lại.");
      setIsLoading(false);
    }
  };

  const formatLockoutTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-surface-muted">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden p-8 animate-fade-in-up">
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="bg-primary-soft text-primary p-3.5 rounded-2xl mb-4 shadow-sm animate-heartbeat">
            <Workflow className="w-8 h-8 text-[#0144DB]" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
            Chào mừng trở lại!
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            Đăng nhập vào bảng điều khiển quản trị Didi & Quéo Agent
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          {errorMessage && (
            <div className="p-3.5 bg-danger-soft border border-red-200 rounded-xl text-xs font-semibold text-danger text-center leading-relaxed">
              {errorMessage}{" "}
              {lockoutTimeLeft > 0 && `(Thử lại sau ${formatLockoutTime(lockoutTimeLeft)})`}
            </div>
          )}

          <Field label="Tên đăng nhập" icon={User} required>
            <Input
              type="text"
              name="username"
              value={username}
              disabled={isLoading || lockoutTimeLeft > 0}
              placeholder="Nhập tên đăng nhập..."
              className="h-11 rounded-xl bg-zinc-50/50"
              onChange={(e) => setUsername(e.target.value)}
            />
          </Field>

          <Field label="Mật khẩu" icon={Key} required>
            <Input
              type="password"
              name="password"
              value={password}
              disabled={isLoading || lockoutTimeLeft > 0}
              placeholder="••••••••••••"
              className="h-11 rounded-xl bg-zinc-50/50"
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {requiresOtp && (
            <div className="animate-fade-in-up">
              <Field label="Mã xác thực OTP (2FA)" icon={ShieldCheck} required>
                <Input
                  type="text"
                  maxLength={6}
                  pattern="[0-9]*"
                  inputMode="numeric"
                  name="otp"
                  value={otp}
                  disabled={isLoading}
                  placeholder="123456"
                  className="h-11 rounded-xl bg-zinc-50/50 text-center font-mono tracking-widest text-lg font-bold"
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                />
              </Field>
            </div>
          )}

          <Button
            type="submit"
            variant="primary"
            className="w-full h-11 text-white rounded-xl font-bold transition-all mt-2 cursor-pointer"
            isLoading={isLoading}
            disabled={lockoutTimeLeft > 0}
          >
            {requiresOtp ? "Xác nhận OTP" : "Đăng nhập"}
          </Button>
        </form>
      </div>
    </div>
  );
}
