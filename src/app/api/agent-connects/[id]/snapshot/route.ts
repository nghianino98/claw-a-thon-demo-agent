import { NextRequest, NextResponse } from "next/server";
import { requireDidiAccess } from "@/lib/api/guard";
import { buildAgentUrl, getAgentConnectionWithSecrets } from "@/lib/agent-connections";

export const runtime = "nodejs";

async function fetchAdminJson(connection: { baseUrl: string; adminToken: string }, path: string) {
  const response = await fetch(buildAgentUrl(connection.baseUrl, `admin/api/${path}`), {
    headers: { Authorization: `Bearer ${connection.adminToken}` },
    signal: AbortSignal.timeout(Number(process.env.AGENT_PROXY_TIMEOUT_MS || 30_000)),
  });
  const data = await response.json().catch(() => ({}));
  return response.ok ? data : { error: data?.error || `HTTP ${response.status}` };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "viewer", { action: "agent_connection_snapshot" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const connection = getAgentConnectionWithSecrets(id);
  if (!connection || !connection.enabled) return NextResponse.json({ error: "agent_connection_not_found" }, { status: 404 });
  if (!connection.adminToken) return NextResponse.json({ error: "agent_admin_token_not_configured" }, { status: 503 });

  const [instructions, skills, workflows] = await Promise.all([
    fetchAdminJson(connection, "instructions"),
    fetchAdminJson(connection, "skills"),
    fetchAdminJson(connection, "workflows"),
  ]);

  return NextResponse.json({ instructions, skills, workflows });
}
