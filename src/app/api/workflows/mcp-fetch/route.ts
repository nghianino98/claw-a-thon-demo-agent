import { NextRequest, NextResponse } from "next/server";
import { requireDidiAccess } from "@/lib/api/guard";
import { buildAgentUrl, getAgentConnectionWithSecrets, getDefaultAgentConnectionWithSecrets } from "@/lib/agent-connections";

export const runtime = "nodejs";

/**
 * Lấy data thật từ Tableau (atlas) qua MCP server chạy LOCAL trên cùng máy.
 *
 * Vì sao gọi MCP trực tiếp (không qua agent): agent Quéo (`/invocations`) chỉ có
 * bộ 9 tool KB — KHÔNG nạp MCP servers vào ToolRegistry, nên agent không tự kéo được
 * data atlas. Didi chạy local cùng máy với MCP bridge (start.sh → :3927/tableau-mcp),
 * nên Didi đóng vai MCP client, gọi thẳng tool `get-view-data` / `list-views`.
 *
 * Transport: MCP streamable-HTTP (JSON-RPC qua SSE).
 *   1) POST initialize            → lấy header `mcp-session-id`
 *   2) POST notifications/initialized (kèm session-id)
 *   3) POST tools/call            → đọc dòng `data:` có `result` khớp id
 */

const MCP_URL = process.env.TABLEAU_MCP_URL || "http://127.0.0.1:3927/tableau-mcp";
const MCP_APIKEY = process.env.TABLEAU_MCP_APIKEY || ""; // chỉ cần khi trỏ qua auth-proxy :3928
const JIRA_MCP_SECRET = process.env.JIRA_MCP_SECRET || process.env.JIRA_CONFLUENCE_MCP_SECRET || "";

const MCP_HEADERS = (sessionId?: string, apiKey = MCP_APIKEY, extraHeaders: Record<string, string> = {}): Record<string, string> => ({
  ...extraHeaders,
  "Content-Type": "application/json",
  Accept: "application/json, text/event-stream",
  ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  ...(sessionId ? { "mcp-session-id": sessionId } : {}),
});

type McpEndpoint = {
  url: string;
  apiKey: string;
  source: string;
  headers?: Record<string, string>;
};

type RemoteMcpServer = {
  id?: string;
  server_id?: string;
  name?: string;
  transport?: string;
  baseUrl?: string;
  base_url?: string;
  enabled?: boolean | number;
};

type JsonRpcToolMessage = {
  id?: number;
  result?: {
    content?: Array<{ text?: string }>;
    tools?: Array<{ name?: string; description?: string }>;
    isError?: boolean;
  };
  error?: {
    message?: string;
    [key: string]: unknown;
  };
};

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function asString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function isJiraConfluenceMcp(server: RemoteMcpServer) {
  const text = [
    server.id,
    server.server_id,
    server.name,
    server.baseUrl,
    server.base_url,
  ].filter(Boolean).join(" ").toLowerCase();
  return text.includes("jira") || text.includes("confluence");
}

// Đọc body SSE, trả về JSON-RPC message có `id` khớp và chứa `result` (bỏ qua notifications/message debug).
function pickResult(sseText: string, id: number): JsonRpcToolMessage | null {
  for (const line of sseText.split("\n")) {
    const t = line.trim();
    if (!t.startsWith("data:")) continue;
    const payload = t.slice(5).trim();
    if (!payload) continue;
    try {
      const msg = JSON.parse(payload) as JsonRpcToolMessage;
      if (msg.id === id && (msg.result !== undefined || msg.error !== undefined)) return msg;
    } catch {
      /* dòng SSE không phải JSON hoàn chỉnh — bỏ qua */
    }
  }
  return null;
}

async function mcpInit(endpoint: McpEndpoint): Promise<string> {
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: MCP_HEADERS(undefined, endpoint.apiKey, endpoint.headers),
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "didi-workflow", version: "1.0" },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const sid = res.headers.get("mcp-session-id");
  await res.text(); // drain
  if (!res.ok || !sid) {
    throw new Error(`MCP initialize thất bại (http ${res.status}). MCP bridge có đang chạy ở ${endpoint.url} không?`);
  }
  // bắt buộc theo spec: báo client đã sẵn sàng
  await fetch(endpoint.url, {
    method: "POST",
    headers: MCP_HEADERS(sid, endpoint.apiKey, endpoint.headers),
    body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    signal: AbortSignal.timeout(15_000),
  }).then((r) => r.text()).catch(() => {});
  return sid;
}

async function mcpRequest(endpoint: McpEndpoint, sid: string, id: number, method: string, params: Record<string, unknown>, timeoutMs = 120_000): Promise<JsonRpcToolMessage> {
  const res = await fetch(endpoint.url, {
    method: "POST",
    headers: MCP_HEADERS(sid, endpoint.apiKey, endpoint.headers),
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  const msg = pickResult(text, id);
  if (!msg) throw new Error(`MCP method "${method}" không trả kết quả (http ${res.status}).`);
  if (msg.error) throw new Error(`MCP method "${method}" lỗi: ${msg.error.message || JSON.stringify(msg.error)}`);
  return msg;
}

async function mcpCall(endpoint: McpEndpoint, sid: string, id: number, name: string, args: Record<string, unknown>, timeoutMs = 120_000): Promise<string> {
  const msg = await mcpRequest(endpoint, sid, id, "tools/call", { name, arguments: args }, timeoutMs);
  const content = msg.result?.content || [];
  const out = content.map((c) => c.text || "").join("");
  if (msg.result?.isError) throw new Error(`Tool "${name}" báo lỗi: ${out.slice(0, 300)}`);
  return out;
}

async function resolveMcpEndpoint(input: {
  agentConnectionId?: string;
  mcpConnectionId?: string;
}): Promise<McpEndpoint> {
  const fallback = {
    url: MCP_URL,
    apiKey: MCP_APIKEY,
    source: input.mcpConnectionId ? `env fallback for ${input.mcpConnectionId}` : "env",
  };

  if (!input.mcpConnectionId) return fallback;

  const agentConnection = input.agentConnectionId
    ? getAgentConnectionWithSecrets(input.agentConnectionId)
    : getDefaultAgentConnectionWithSecrets();
  if (!agentConnection?.adminToken) return fallback;

  try {
    const response = await fetch(buildAgentUrl(agentConnection.baseUrl, "admin/api/mcp/servers"), {
      headers: {
        Authorization: `Bearer ${agentConnection.adminToken}`,
        "X-Acting-User": "didi-workflow",
        "X-Acting-Role": "operator",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return fallback;

    const payload = await response.json();
    const servers = Array.isArray(payload?.servers) ? payload.servers as RemoteMcpServer[] : [];
    const selected = servers.find((server) => (server.id || server.server_id) === input.mcpConnectionId);
    if (!selected) return fallback;

    const baseUrl = String(selected.baseUrl || selected.base_url || "").trim();
    if (selected.transport === "http" && baseUrl) {
      return {
        url: baseUrl,
        apiKey: MCP_APIKEY,
        source: selected.name || input.mcpConnectionId,
        headers: isJiraConfluenceMcp(selected) && JIRA_MCP_SECRET ? { "x-mcp-secret": JIRA_MCP_SECRET } : undefined,
      };
    }

    return {
      ...fallback,
      source: `${selected.name || input.mcpConnectionId} (${selected.transport || "stdio"} via local bridge)`,
    };
  } catch {
    return fallback;
  }
}

// Tách tên view từ Tableau board URL: .../views/<workbook>/<view>?...  → "<view>"
function viewNameFromUrl(url: string): string | null {
  try {
    const m = decodeURIComponent(url).match(/\/views\/[^/]+\/([^/?#]+)/i);
    return m ? m[1].replace(/[_-]+/g, " ").trim() : null;
  } catch {
    return null;
  }
}

const STOP = new Set(["the", "and", "for", "data", "phan", "tich", "report", "current", "month", "metrics", "context", "needed", "collect", "view", "dashboard", "của", "data."]);
function keywordsFrom(s: string): string[] {
  return (s || "")
    .split(/[^\p{L}\p{N}]+/u)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()));
}

type ViewRef = { id: string; name: string; contentUrl?: string; viewUrl?: string };

// Lấy danh sách view rồi chọn các view khớp viewName / boardUrl / keywords.
function resolveViews(catalog: ViewRef[], opts: { viewName?: string; boardUrl?: string; dataRequest?: string; max: number }): ViewRef[] {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, "").trim();

  // 1. Nếu có boardUrl, thử đối khớp đường dẫn đầy đủ trước (tránh trùng tên view giữa các workbook khác nhau)
  if (opts.boardUrl) {
    const decodedUrl = decodeURIComponent(opts.boardUrl).toLowerCase();
    
    // Tìm view khớp chính xác theo contentUrl hoặc viewUrl dạng đường dẫn chứa cả workbook + view
    const pathMatch = catalog.find((v) => {
      if (v.contentUrl) {
        const normContent = v.contentUrl.toLowerCase().replace("/sheets/", "/");
        if (normContent && decodedUrl.includes(normContent)) return true;
      }
      if (v.viewUrl) {
        const normView = v.viewUrl.toLowerCase();
        if (normView && decodedUrl.includes(normView)) return true;
      }
      return false;
    });

    if (pathMatch) {
      return [pathMatch].slice(0, opts.max);
    }

    // Gợi ý dự phòng: Trích xuất workbookName và viewName từ URL rồi tìm view chứa cả 2 từ khoá này
    const m = decodedUrl.match(/\/views\/([^/]+)\/([^/?#]+)/i);
    if (m) {
      const workbookName = m[1];
      const viewName = m[2];
      const matchByWorkbook = catalog.filter((v) => {
        const normContent = (v.contentUrl || "").toLowerCase();
        const normView = (v.viewUrl || "").toLowerCase();
        return (
          (normContent.includes(workbookName) && normContent.includes(viewName)) ||
          (normView.includes(workbookName) && normView.includes(viewName))
        );
      });
      if (matchByWorkbook.length) {
        return matchByWorkbook.slice(0, opts.max);
      }
    }
  }

  // 2. Đối khớp theo tên tường minh (Ưu tiên tên view trích xuất từ URL để tránh bị đè bởi stale viewName cũ)
  const explicit = (opts.boardUrl ? viewNameFromUrl(opts.boardUrl) : null) || opts.viewName;
  if (explicit) {
    const e = norm(explicit);
    const exact = catalog.filter((v) => norm(v.name) === e);
    if (exact.length) return exact.slice(0, opts.max);
    const partial = catalog.filter((v) => norm(v.name).includes(e) || e.includes(norm(v.name)));
    if (partial.length) return partial.slice(0, opts.max);
  }

  // 3. Đối khớp theo từ khoá mô tả
  const kws = keywordsFrom(opts.dataRequest || "").concat(explicit ? keywordsFrom(explicit) : []);
  if (kws.length) {
    const scored = catalog
      .map((v) => ({ v, score: kws.filter((k) => norm(v.name).includes(k.toLowerCase())).length }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored.length) return scored.slice(0, opts.max).map((x) => x.v);
  }
  return [];
}

export async function POST(req: NextRequest) {
  const gate = requireDidiAccess(req, "operator", { csrf: true, action: "workflow_mcp_fetch" });
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown> = {};
  try {
    body = asRecord(await req.json());
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const {
    boardUrl: rawBoardUrl = "",
    dataRequest: rawDataRequest = "",
    viewId: rawViewId = "",
    viewName: rawViewName = "",
    agentConnectionId: rawAgentConnectionId = "",
    mcpConnectionId: rawMcpConnectionId = "",
    maxViews = 3,
    tool, // mode raw: gọi thẳng 1 tool
    arguments: rawArgs,
  } = body || {};
  const boardUrl = asString(rawBoardUrl);
  const dataRequest = asString(rawDataRequest);
  const viewId = asString(rawViewId);
  const viewName = asString(rawViewName);
  const agentConnectionId = asString(rawAgentConnectionId);
  const mcpConnectionId = asString(rawMcpConnectionId);

  try {
    const endpoint = await resolveMcpEndpoint({
      agentConnectionId: String(agentConnectionId || ""),
      mcpConnectionId: String(mcpConnectionId || ""),
    });
    const sid = await mcpInit(endpoint);
    let rid = 10;

    // ---- mode raw: passthrough 1 tool call ----
    if (tool) {
      if (String(tool) === "__tools/list" || String(tool) === "tools/list") {
        const msg = await mcpRequest(endpoint, sid, ++rid, "tools/list", asRecord(rawArgs), 30_000);
        const tools = (msg.result?.tools || []).map((item) => item.name || "").filter(Boolean);
        return NextResponse.json({ ok: true, mode: "raw", tool, endpoint: endpoint.source, toolCount: tools.length, tools });
      }
      const out = await mcpCall(endpoint, sid, ++rid, String(tool), asRecord(rawArgs));
      return NextResponse.json({ ok: true, mode: "raw", tool, endpoint: endpoint.source, result: out });
    }

    // ---- mode auto: resolve view(s) → get-view-data ----
    let targets: ViewRef[] = [];
    if (viewId) {
      targets = [{ id: String(viewId), name: viewName || String(viewId) }];
    } else {
      let catalog: ViewRef[] = [];
      let listRaw = "";
      let matchedByFilter = false;

      // 1. Thử tìm nhanh bằng filter contentUrl nếu có boardUrl hợp lệ
      if (boardUrl) {
        const m = decodeURIComponent(boardUrl).match(/\/views\/([^/]+)\/([^/?#]+)/i);
        if (m) {
          const workbookName = m[1];
          const viewUrlname = m[2];
          try {
            const filter = `contentUrl:eq:${workbookName}/sheets/${viewUrlname}`;
            const filterRaw = await mcpCall(endpoint, sid, ++rid, "list-views", { filter, limit: 10 });
            const parsed = JSON.parse(filterRaw);
            const parsedRecord = asRecord(parsed);
            const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsedRecord.views) ? parsedRecord.views : Array.isArray(parsedRecord.data) ? parsedRecord.data : [];
            if (arr.length > 0) {
              catalog = arr
                .map((value) => asRecord(value))
                .filter((v) => typeof v.id === "string")
                .map((v) => ({
                  id: asString(v.id),
                  name: asString(v.name) || asString(v.contentUrl) || asString(v.id),
                  contentUrl: asString(v.contentUrl),
                  viewUrl: asString(v.viewUrl || v.viewUrlName || v.viewUrlname),
                }));
              matchedByFilter = true;
            }
          } catch {
            // Bỏ qua lỗi filter, chạy tiếp fallback list-views toàn bộ
          }
        }
      }

      // 2. Fallback: Lấy danh sách views toàn bộ (tăng limit lên 1000 để tránh trôi dòng ở site lớn)
      if (!matchedByFilter) {
        try {
          listRaw = await mcpCall(endpoint, sid, ++rid, "list-views", { limit: 1000 });
          const parsed = JSON.parse(listRaw);
          const parsedRecord = asRecord(parsed);
          const arr = Array.isArray(parsed) ? parsed : Array.isArray(parsedRecord.views) ? parsedRecord.views : Array.isArray(parsedRecord.data) ? parsedRecord.data : [];
          catalog = arr
            .map((value) => asRecord(value))
            .filter((v) => typeof v.id === "string")
            .map((v) => ({
              id: asString(v.id),
              name: asString(v.name) || asString(v.contentUrl) || asString(v.id),
              contentUrl: asString(v.contentUrl),
              viewUrl: asString(v.viewUrl || v.viewUrlName || v.viewUrlname),
            }));
        } catch {
          return NextResponse.json({ error: "list_views_parse_failed", sample: listRaw.slice(0, 300) }, { status: 502 });
        }
      }

      targets = resolveViews(catalog, { viewName, boardUrl, dataRequest, max: Number(maxViews) || 3 });
      if (!targets.length) {
        // không match → trả catalog để người dùng/agent chọn lại
        return NextResponse.json({
          ok: false,
          reason: "no_view_matched",
          message: "Không tìm thấy view nào khớp. Hãy đặt viewName chính xác hoặc dùng boardUrl có path /views/<workbook>/<view>.",
          catalogCount: catalog.length,
          suggestions: catalog
            .filter((v) => keywordsFrom(dataRequest).some((k) => v.name.toLowerCase().includes(k.toLowerCase())))
            .slice(0, 20)
            .map((v) => v.name),
        });
      }
    }

    // get-view-data cho từng view, gói thành markdown. Một vài dashboard không export được data;
    // bỏ qua view lỗi và tiếp tục view kế tiếp để workflow không chết ngay ở match đầu tiên.
    const blocks: string[] = [];
    const fetched: { name: string; id: string; rows: number }[] = [];
    const failed: { name: string; id: string; error: string }[] = [];
    for (const t of targets) {
      try {
        const csv = await mcpCall(endpoint, sid, ++rid, "get-view-data", { viewId: t.id });
        const clean = csv.startsWith('"') && csv.endsWith('"') ? JSON.parse(csv) : csv; // tool trả CSV trong chuỗi JSON
        const rows = String(clean).trim().split("\n").length - 1;
        fetched.push({ name: t.name, id: t.id, rows });
        blocks.push(`### View: ${t.name}\n_(viewId: ${t.id} · ~${rows} dòng)_\n\n\`\`\`csv\n${String(clean).trim()}\n\`\`\``);
      } catch (error) {
        failed.push({ name: t.name, id: t.id, error: error instanceof Error ? error.message : "get_view_data_failed" });
      }
    }

    if (!fetched.length) {
      const firstError = failed[0]?.error || "Không lấy được data từ các view đã match.";
      return NextResponse.json(
        {
          ok: false,
          reason: "get_view_data_failed",
          message: firstError,
          endpoint: endpoint.source,
          failed,
        },
        { status: 502 },
      );
    }

    const markdown = [
      `# Dữ liệu Atlas (Tableau MCP) — ${fetched.length} view`,
      ``,
      `MCP connection: ${endpoint.source}`,
      boardUrl ? `Board URL: ${boardUrl}` : "",
      dataRequest ? `Yêu cầu: ${dataRequest}` : "",
      failed.length ? `Bỏ qua ${failed.length} view không export được data: ${failed.map((item) => item.name).join(", ")}` : "",
      ``,
      ...blocks,
    ]
      .filter(Boolean)
      .join("\n");

    return NextResponse.json({ ok: true, mode: "auto", endpoint: endpoint.source, views: fetched, failed, markdown });
  } catch (err: unknown) {
    const error = err instanceof Error ? err : null;
    const msg = error?.name === "TimeoutError" ? "MCP timeout — view quá lớn hoặc bridge treo." : error?.message || "mcp_fetch_failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
