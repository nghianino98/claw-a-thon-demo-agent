import { NextRequest, NextResponse } from "next/server";
import { issueCsrf } from "@/lib/auth/csrf";
import { getAuthContext } from "@/lib/auth/session";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const auth = getAuthContext(request);
  if (!auth) {
    return NextResponse.json({
      authMode: process.env.AUTH_MODE || "off",
      authenticated: false,
    });
  }

  return NextResponse.json({
    authMode: process.env.AUTH_MODE || "off",
    authenticated: true,
    user: {
      id: auth.userId,
      username: auth.username,
      role: auth.role,
      mustChangePassword: Boolean(auth.mustChangePassword),
      hasTotp: Boolean(auth.hasTotp),
    },
    csrfToken: auth.csrfRequired && auth.tokenHash ? issueCsrf(auth.tokenHash) : null,
  });
}
