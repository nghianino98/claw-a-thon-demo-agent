import type { Metadata } from "next";
import "./globals.css";
import { AuthWrapper } from "@/components/layout/auth-wrapper";
import { LayoutContent } from "@/components/layout/layout-content";

export const metadata: Metadata = {
  title: "Didi AI Tool",
  description: "Trợ lý ảo đa năng và công cụ xây dựng quy trình AI",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="antialiased bg-[--color-surface-muted] text-zinc-900 min-h-screen flex flex-col"
      >
        <AuthWrapper>
          <LayoutContent>{children}</LayoutContent>
        </AuthWrapper>
      </body>
    </html>
  );
}
