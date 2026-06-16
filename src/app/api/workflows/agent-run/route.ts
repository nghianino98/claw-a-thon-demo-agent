import { NextRequest, NextResponse } from "next/server";
import { requireDidiAccess } from "@/lib/api/guard";
import { buildAgentUrl, getAgentConnectionWithSecrets, getDefaultAgentConnectionWithSecrets } from "@/lib/agent-connections";

export const runtime = "nodejs";

type AgentRunBody = Record<string, unknown>;

function bodyString(body: AgentRunBody, key: string) {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

/**
 * Gọi agent Quéo (`POST /invocations`) để PHÂN TÍCH dữ liệu đã có.
 *
 * Agent không tự kéo được data atlas (ToolRegistry chỉ có tool KB), nên bước
 * dataSource (mcp-fetch) lấy data trước rồi truyền vào đây qua `upstream`.
 * Agent đóng vai chuyên gia phân tích trên dữ liệu được đưa sẵn.
 *
 * Auth runtime: header `Authorization: Bearer <Agent Connect API key>`.
 */

export async function POST(req: NextRequest) {
  const gate = requireDidiAccess(req, "operator", { csrf: true, action: "workflow_agent_run" });
  if (!gate.ok) return gate.response;

  let body: AgentRunBody = {};
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const connectionId = bodyString(body, "agentConnectionId");
  const connection = connectionId
    ? getAgentConnectionWithSecrets(connectionId)
    : getDefaultAgentConnectionWithSecrets();
  if (!connection || !connection.enabled || !connection.apiKey) {
    return NextResponse.json(
      { error: "agent_not_configured", message: "Cần khai báo Agent Connect có Agent API key trong Didi." },
      { status: 503 },
    );
  }

  const instruction = bodyString(body, "instruction");
  const upstream = bodyString(body, "upstream");
  const sessionId = bodyString(body, "sessionId") || "didi-workflow";
  const workflowId = bodyString(body, "workflowId");
  const skillId = bodyString(body, "skillId");

  if (!instruction && !upstream) {
    return NextResponse.json({ error: "empty_message" }, { status: 400 });
  }

  const message = [
    workflowId ? `Agent workflow được chọn: ${workflowId}` : "",
    skillId ? `Agent skill được chọn: ${skillId}` : "",
    instruction,
    upstream ? `\n\n--- DỮ LIỆU ĐẦU VÀO (từ Tableau/atlas) ---\n${upstream}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  try {
    const res = await fetch(buildAgentUrl(connection.baseUrl, "invocations"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${connection.apiKey}`,
      },
      body: JSON.stringify({ message, user_id: "didi-workflow", session_id: sessionId }),
      signal: AbortSignal.timeout(Number(process.env.AGENT_INVOKE_TIMEOUT_MS || 180_000)),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.status === "error") {
      return NextResponse.json(
        { error: data?.error || `agent_http_${res.status}` },
        { status: res.status === 200 ? 502 : res.status },
      );
    }

    return NextResponse.json({
      ok: true,
      response: data.response || "",
      citations: data.citations || [],
      mode: data.mode,
    });
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string } | null;
    const msg = error?.name === "TimeoutError" ? "Agent timeout." : error?.message || "agent_run_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
