import { NextResponse, type NextRequest } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { verifyCsrf } from "@/lib/auth/csrf";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import { hasRole, type Role } from "@/lib/rbac/roles";

type GuardOptions = {
  csrf?: boolean;
  action?: string;
  target?: string;
};

export type GuardResult =
  | { ok: true; auth: AuthContext }
  | { ok: false; response: NextResponse };

export function requireDidiAccess(
  request: NextRequest,
  minimumRole: Role,
  options: GuardOptions = {},
): GuardResult {
  const auth = getAuthContext(request);
  if (!auth) {
    return { ok: false, response: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };
  }

  if (!hasRole(auth.role, minimumRole)) {
    audit(auditActor(auth.username), options.action || "didi_api_denied", options.target || request.nextUrl.pathname);
    return { ok: false, response: NextResponse.json({ error: "forbidden" }, { status: 403 }) };
  }

  if (options.csrf && auth.csrfRequired) {
    const valid = verifyCsrf(request.headers.get("x-csrf-token"), auth.tokenHash);
    if (!valid) {
      audit(auditActor(auth.username), "csrf_denied", options.target || request.nextUrl.pathname);
      return { ok: false, response: NextResponse.json({ error: "csrf" }, { status: 403 }) };
    }
  }

  return { ok: true, auth };
}

export function requireOwnOrSuperadmin(auth: AuthContext, ownerUserId: number) {
  return auth.role === "superadmin" || auth.userId === ownerUserId;
}
