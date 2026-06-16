import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { buildAgentUrl, getAgentConnectionWithSecrets } from "@/lib/agent-connections";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type CheckResult = {
  ok: boolean;
  statusCode: number;
  body?: unknown;
  skipped?: boolean;
  error: string;
};

async function readJsonOrText(response: Response) {
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json().catch(() => null);
  }
  return response.text().catch(() => "");
}

async function runCheck(input: {
  url: URL;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
}): Promise<CheckResult> {
  try {
    const response = await fetch(input.url, {
      method: input.method || "GET",
      headers: {
        ...(input.body ? { "Content-Type": "application/json" } : {}),
        ...input.headers,
      },
      body: input.body ? JSON.stringify(input.body) : undefined,
      signal: AbortSignal.timeout(input.timeoutMs || 20_000),
    });
    const body = await readJsonOrText(response);
    return {
      ok: response.ok,
      statusCode: response.status,
      body,
      error: response.ok ? "" : `HTTP ${response.status}`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "connection_failed";
    return { ok: false, statusCode: 0, error: message };
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "agent_connection_test" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const connection = getAgentConnectionWithSecrets(id);
  if (!connection) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const health = await runCheck({ url: buildAgentUrl(connection.baseUrl, "health") });
  const warnings: string[] = [];

  const admin: CheckResult = connection.adminToken
    ? await runCheck({
        url: buildAgentUrl(connection.baseUrl, "admin/api/status"),
        headers: {
          Authorization: `Bearer ${connection.adminToken}`,
          "X-Acting-User": gate.auth.username,
          "X-Acting-Role": gate.auth.role,
        },
      })
    : { ok: false, statusCode: 0, skipped: true, error: "missing_admin_token" };
  if (admin.skipped) warnings.push("Chưa khai báo Admin token nên chưa test được API view/update/create.");

  const invocation: CheckResult = connection.apiKey
    ? await runCheck({
        url: buildAgentUrl(connection.baseUrl, "invocations"),
        method: "POST",
        headers: { Authorization: `Bearer ${connection.apiKey}` },
        body: {
          message: "ping",
          user_id: "didi-connect-test",
          session_id: `didi-connect-${Date.now()}`,
        },
        timeoutMs: 45_000,
      })
    : { ok: false, statusCode: 0, skipped: true, error: "missing_api_key" };
  if (invocation.skipped) warnings.push("Chưa khai báo Agent API key nên chưa test được /invocations.");

  const status = health.ok && (admin.ok || admin.skipped) && (invocation.ok || invocation.skipped) ? "connected" : "error";
  const lastError = status === "connected"
    ? ""
    : [
        health.ok ? "" : `health: ${health.error}`,
        admin.ok || admin.skipped ? "" : `admin: ${admin.error}`,
        invocation.ok || invocation.skipped ? "" : `invocation: ${invocation.error}`,
      ]
        .filter(Boolean)
        .join("; ");

  getDb()
    .prepare("UPDATE agent_connections SET status = ?, last_error = ?, last_checked_at = ?, updated_at = ? WHERE id = ?")
    .run(status, lastError || null, now(), now(), id);

  audit(auditActor(gate.auth.username), "agent_connection_test", id, { status, health: health.statusCode, admin: admin.statusCode, invocation: invocation.statusCode });

  return NextResponse.json({ status, health, admin, invocation, warnings });
}
