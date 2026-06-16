"use client";

import * as React from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/store/auth-store";
import { LoadingState } from "@/components/ui/loading-state";
import { ToastContainer } from "@/components/ui/toast";

export function AuthWrapper({ children }: { children: React.ReactNode }) {
  const { authMode, authenticated, user, status, bootstrap } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  React.useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  // Handle client-side routing redirects
  React.useEffect(() => {
    if (status !== "ready" || authMode === "off") return;

    if (!authenticated) {
      if (pathname !== "/login" && !pathname.startsWith("/api/")) {
        router.replace("/login");
      }
    } else if (user?.mustChangePassword) {
      if (pathname !== "/change-password") {
        router.replace("/change-password");
      }
    } else if (!user?.hasTotp) {
      if (pathname !== "/setup-2fa") {
        router.replace("/setup-2fa");
      }
    } else {
      // Authenticated, 2FA enabled, password changed
      if (pathname === "/login" || pathname === "/change-password" || pathname === "/setup-2fa" || pathname === "/") {
        router.replace("/knowledge-base");
      }
    }
  }, [status, authMode, authenticated, user, pathname, router]);

  // Show premium loading state on startup auth fetch
  if (status === "loading") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-[--color-surface-muted]">
        <div className="text-center">
          <LoadingState message="Đang xác thực phiên làm việc..." size="lg" />
        </div>
      </div>
    );
  }

  return (
    <>
      {children}
      <ToastContainer />
    </>
  );
}
