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
    } else {
      // Authenticated
      const isSuperAdmin = user?.role === "superadmin";
      const allowedMenus = user?.menuPermissions || [];
      const CONFIGURABLE_MENUS = [
        "/settings/mcp",
        "/settings",
        "/knowledge-base",
        "/history",
        "/workflows",
        "/agent-admin/dashboard",
        "/agent-admin/agent-connects",
        "/agent-admin/bot-management",
        "/agent-admin/instructions",
        "/agent-admin/skills",
        "/agent-admin/knowledge"
      ];
      const sortedMenus = [...CONFIGURABLE_MENUS].sort((a, b) => b.length - a.length);

      const isRestrictedMenu = (() => {
        if (isSuperAdmin) return false;

        if (pathname === "/accounts" || pathname.startsWith("/accounts/")) {
          return true;
        }

        const matchingMenu = sortedMenus.find(menu => pathname === menu || pathname.startsWith(menu + "/"));
        if (matchingMenu) {
          return !allowedMenus.includes(matchingMenu);
        }
        return false;
      })();

      if (isRestrictedMenu) {
        const fallbackPath = allowedMenus[0] || "/login";
        router.replace(fallbackPath);
      } else if (pathname === "/login" || pathname === "/change-password" || pathname === "/setup-2fa" || pathname === "/") {
        const fallbackPath = isSuperAdmin ? "/knowledge-base" : (allowedMenus[0] || "/login");
        router.replace(fallbackPath);
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
