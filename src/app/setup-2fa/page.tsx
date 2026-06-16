"use client";

import * as React from "react";
import { useAuth } from "@/lib/store/auth-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/field";
import { CopyField } from "@/components/ui/copy-field";
import { toast } from "@/lib/store/toast-store";
import { apiFetch } from "@/lib/api/client";
import { ShieldAlert, ShieldCheck } from "lucide-react";
import QRCode from "qrcode";

export default function Setup2faPage() {
  const { bootstrap } = useAuth();

  const [secret, setSecret] = React.useState("");
  const [otpauthUrl, setOtpauthUrl] = React.useState("");
  const [otp, setOtp] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isInitializing, setIsInitializing] = React.useState(true);
  const [errorMsg, setErrorMsg] = React.useState("");

  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Load 2FA configuration from backend on mount
  React.useEffect(() => {
    let active = true;

    async function init2FA() {
      try {
        const data = await apiFetch<{ secret: string; otpauthUrl: string }>("/api/auth/setup-2fa/start", { method: "POST" });
        if (active) {
          setSecret(data.secret);
          setOtpauthUrl(data.otpauthUrl);
        }
      } catch (err) {
        console.error("Failed to start 2FA configuration:", err);
        if (active) {
          setErrorMsg("Không thể thiết lập 2FA. Vui lòng thử lại.");
        }
      } finally {
        if (active) {
          setIsInitializing(false);
        }
      }
    }

    init2FA();

    return () => {
      active = false;
    };
  }, []);

  // Render QR Code onto the canvas once otpauthUrl is ready
  React.useEffect(() => {
    if (!otpauthUrl || !canvasRef.current) return;

    QRCode.toCanvas(
      canvasRef.current,
      otpauthUrl,
      {
        width: 220,
        margin: 2,
        color: {
          dark: "#0a0a0a",
          light: "#ffffff",
        },
      },
      (err) => {
        if (err) {
          console.error("QR Code rendering failed:", err);
          setErrorMsg("Không thể kết xuất mã QR. Vui lòng sử dụng mã nhập tay.");
        }
      }
    );
  }, [otpauthUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp || otp.length < 6 || isLoading) return;

    setIsLoading(true);
    setErrorMsg("");

    try {
      await apiFetch("/api/auth/setup-2fa/verify", {
        method: "POST",
        body: JSON.stringify({ secret, otp }),
      });

      toast.success("Kích hoạt xác thực 2 bước thành công!");
      await bootstrap();
      // Redirect handled by AuthWrapper
    } catch (err) {
      console.error(err);
      setErrorMsg("Mã OTP không chính xác. Vui lòng thử lại.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isInitializing) {
    return (
      <div className="flex min-h-screen items-center justify-center p-4 bg-[--color-surface-muted]">
        <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden p-8 flex flex-col items-center justify-center min-h-[300px]">
          <div className="w-10 h-10 border-4 border-zinc-200 border-t-[--color-primary] rounded-full animate-spin mb-4" />
          <p className="text-zinc-500 font-semibold text-sm">Đang tải cấu hình 2FA...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-[--color-surface-muted]">
      <div className="w-full max-w-md bg-white border border-zinc-200 rounded-2xl shadow-xl overflow-hidden p-8 animate-fade-in-up">
        <div className="flex flex-col items-center text-center mb-6">
          <div className="bg-[--color-primary-soft] text-[--color-primary] p-3.5 rounded-2xl mb-4 shadow-sm">
            <ShieldAlert className="w-8 h-8 animate-[pulse_2s_infinite]" />
          </div>
          <h2 className="text-2xl font-extrabold text-zinc-900 tracking-tight">
            Thiết lập 2FA (Xác thực 2 bước)
          </h2>
          <p className="text-zinc-500 text-sm mt-1">
            Quét mã QR bằng ứng dụng Authenticator (Google/Microsoft) để lấy OTP
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5 flex flex-col items-center">
          {errorMsg && (
            <div className="w-full p-3.5 bg-[--color-danger-soft] border border-red-200 rounded-xl text-xs font-semibold text-[--color-danger] text-center leading-relaxed">
              {errorMsg}
            </div>
          )}

          {/* QR Code Canvas */}
          {otpauthUrl && (
            <div className="border border-zinc-200 rounded-2xl overflow-hidden p-3 bg-white shadow-sm flex items-center justify-center mb-2">
              <canvas ref={canvasRef} className="w-[220px] h-[220px] block" />
            </div>
          )}

          {/* Manual Entry Key */}
          {secret && (
            <div className="w-full space-y-1">
              <span className="text-xs text-zinc-500 font-semibold block text-left">
                Nếu không thể quét mã QR, hãy nhập mã khóa sau:
              </span>
              <CopyField value={secret} hideValue />
            </div>
          )}

          {/* OTP Code Verification Input */}
          <div className="w-full">
            <Field label="Mã xác thực OTP (6 số)" icon={ShieldCheck} required>
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

          <Button
            type="submit"
            variant="primary"
            disabled={otp.length < 6 || isLoading}
            isLoading={isLoading}
            className="w-full h-11 hover:opacity-90 active:scale-[0.98] text-white rounded-xl font-bold transition-all cursor-pointer mt-2"
          >
            Kích hoạt & Tiếp tục
          </Button>
        </form>
      </div>
    </div>
  );
}
