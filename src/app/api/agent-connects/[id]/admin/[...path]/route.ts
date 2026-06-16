import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { verifyCsrf } from "@/lib/auth/csrf";
import { getAuthContext } from "@/lib/auth/session";
import { buildAgentUrl, getAgentConnectionWithSecrets } from "@/lib/agent-connections";
import { requiredAgentAdminRole } from "@/lib/rbac/agent-admin";
import { hasRole } from "@/lib/rbac/roles";

export const runtime = "nodejs";

async function handler(
  request: NextRequest,
  context: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await context.params;
  const auth = getAuthContext(request);
  if (!auth) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const adminPath = `/admin/api/${path.join("/")}`;
  const requiredRole = requiredAgentAdminRole(request.method, adminPath);
  if (!requiredRole || !hasRole(auth.role, requiredRole)) {
    audit(auditActor(auth.username), "agent_connect_admin_proxy_denied", `${id}:${adminPath}`, {
      method: request.method,
      role: auth.role,
      requiredRole,
    });
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (request.method !== "GET" && request.method !== "HEAD" && auth.csrfRequired) {
    if (!verifyCsrf(request.headers.get("x-csrf-token"), auth.tokenHash)) {
      audit(auditActor(auth.username), "agent_connect_admin_proxy_csrf_denied", `${id}:${adminPath}`);
      return NextResponse.json({ error: "csrf" }, { status: 403 });
    }
  }

  const filterUserId = auth.role === "superadmin" ? null : auth.userId;
  const connection = getAgentConnectionWithSecrets(id, filterUserId);
  if (!connection || !connection.enabled) {
    return NextResponse.json({ error: "agent_connection_not_found" }, { status: 404 });
  }
  if (!connection.adminToken) {
    return NextResponse.json({ error: "agent_admin_token_not_configured" }, { status: 503 });
  }

  const targetUrl = buildAgentUrl(connection.baseUrl, `${adminPath}${request.nextUrl.search}`);
  const contentType = request.headers.get("content-type") || "";
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const isMultipart = hasBody && contentType.includes("multipart/form-data");
  const timeoutMs = isMultipart
    ? Number(process.env.AGENT_PROXY_UPLOAD_TIMEOUT_MS || 120_000)
    : Number(process.env.AGENT_PROXY_TIMEOUT_MS || 30_000);

  try {
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: {
        Authorization: `Bearer ${connection.adminToken}`,
        "X-Acting-User": auth.username,
        "X-Acting-Role": auth.role,
        ...(contentType ? { "Content-Type": contentType } : {}),
      },
      body: !hasBody ? undefined : isMultipart ? request.body : await request.arrayBuffer(),
      signal: AbortSignal.timeout(timeoutMs),
      ...(isMultipart ? { duplex: "half" as const } : {}),
    });

    if (request.method !== "GET") {
      audit(auditActor(auth.username), `agent_connect_admin_proxy_call:${request.method}`, `${id}:${adminPath}`, {
        status: response.status,
      });
    }

    return new NextResponse(response.body, {
      status: response.status,
      headers: {
        "Content-Type": response.headers.get("content-type") || "application/json",
      },
    });
  } catch (error) {
    const reason = (error as { name?: string } | null)?.name ?? "";
    const timedOut = reason === "TimeoutError" || reason === "AbortError";
    audit(auditActor(auth.username), "agent_connect_admin_proxy_failed", `${id}:${adminPath}`, {
      method: request.method,
      reason: timedOut ? "timeout" : "unreachable",
    });
    console.error(`[agent-connect proxy] ${id} ${request.method} ${adminPath} failed:`, error);
    return NextResponse.json({ error: "agent_unreachable" }, { status: 502 });
  }
}

export { handler as GET, handler as POST, handler as PUT, handler as PATCH, handler as DELETE };
