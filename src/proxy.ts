import { NextResponse, type NextRequest } from "next/server";
import { clientIp, ipAllowed } from "@/lib/auth/ip";

const SECURITY_HEADERS: Record<string, string> = {
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; img-src 'self' data:; style-src 'self' 'unsafe-inline'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex",
};

function applySecurityHeaders(response: NextResponse) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function isPublicPath(pathname: string) {
  return (
    pathname === "/login" ||
    pathname === "/api/health" ||
    pathname === "/api/me" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/_next") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon.svg"
  );
}

export function proxy(request: NextRequest) {
  if ((process.env.AUTH_MODE || "off") === "off") {
    return NextResponse.next();
  }

  if (process.env.DIDI_ENABLED === "false") {
    return new NextResponse("Not Found", { status: 404 });
  }

  const allowlist = process.env.DIDI_IP_ALLOWLIST;
  if (allowlist && !ipAllowed(clientIp(request), allowlist)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const { pathname } = request.nextUrl;
  if (isPublicPath(pathname)) {
    return applySecurityHeaders(NextResponse.next());
  }

  const hasSessionCookie = Boolean(request.cookies.get("qs_session")?.value);
  const hasBearer = request.headers.get("authorization")?.startsWith("Bearer ");
  if (!hasSessionCookie && !hasBearer) {
    if (pathname.startsWith("/api/")) {
      return applySecurityHeaders(NextResponse.json({ error: "unauthorized" }, { status: 401 }));
    }
    return applySecurityHeaders(NextResponse.redirect(new URL("/login", request.url)));
  }

  return applySecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
