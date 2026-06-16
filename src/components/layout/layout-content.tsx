"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/layout/sidebar";
import { useAuth } from "@/lib/store/auth-store";

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authMode, authenticated } = useAuth();

  const isAuthRoute =
    pathname === "/login" ||
    pathname === "/change-password" ||
    pathname === "/setup-2fa";

  const showSidebar = authMode === "off" || (authenticated && !isAuthRoute);

  return (
    <main className="flex min-h-screen relative w-full max-w-[100vw] flex-row bg-[--color-surface-muted]">
      {showSidebar && <Sidebar />}
      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-y-auto">
        <div className="flex-1 flex flex-col h-full">
          {children}
        </div>
      </div>
    </main>
  );
}
