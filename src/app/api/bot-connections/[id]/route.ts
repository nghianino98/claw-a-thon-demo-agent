import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import {
  encryptBotSecret,
  getBotConnection,
  getBotConnectionRow,
  isBotPlatform,
  listBotConnections,
} from "@/lib/bot-connections";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type PatchBody = {
  platform?: unknown;
  name?: unknown;
  token?: unknown;
  clearToken?: unknown;
  clear_token?: unknown;
  agentConnectionId?: unknown;
  agent_connection_id?: unknown;
  enabled?: unknown;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asBool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : value === 1 ? true : value === 0 ? false : fallback;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "viewer", { action: "bot_connection_read" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  const connection = getBotConnection(id, filterUserId);
  if (!connection) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ connection });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "bot_connection_update" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  if (!getBotConnectionRow(id, filterUserId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.platform !== undefined) {
    const platform = asString(body.platform);
    if (!isBotPlatform(platform)) return NextResponse.json({ error: "invalid_platform" }, { status: 400 });
    sets.push("platform = ?");
    values.push(platform);
  }

  if (body.name !== undefined) {
    const name = asString(body.name);
    if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    sets.push("name = ?");
    values.push(name);
  }

  try {
    if (body.token !== undefined) {
      const token = asString(body.token);
      if (token) {
        sets.push("token_encrypted = ?");
        values.push(encryptBotSecret(token));
        // a new token invalidates the previously verified identity/status
        sets.push("bot_username = NULL");
        sets.push("status = 'unknown'");
      }
    }
  } catch (error) {
    return NextResponse.json(
      { error: "secret_storage_not_configured", message: (error as Error).message },
      { status: 400 },
    );
  }

  if (asBool(body.clearToken ?? body.clear_token)) {
    sets.push("token_encrypted = NULL");
    sets.push("bot_username = NULL");
    sets.push("status = 'unknown'");
  }

  if (body.agentConnectionId !== undefined || body.agent_connection_id !== undefined) {
    const agentConnectionId = asString(body.agentConnectionId ?? body.agent_connection_id);
    sets.push("agent_connection_id = ?");
    values.push(agentConnectionId || null);
  }

  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(asBool(body.enabled) ? 1 : 0);
  }

  if (sets.length === 0) return NextResponse.json({ error: "no_changes" }, { status: 400 });

  sets.push("updated_at = ?");
  values.push(now());

  if (gate.auth.userId !== null && gate.auth.role !== "superadmin") {
    sets.push("user_id = ?");
    values.push(gate.auth.userId);
  }

  if (filterUserId !== null) {
    getDb().prepare(`UPDATE bot_connections SET ${sets.join(", ")} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`).run(...values, id, filterUserId);
  } else {
    getDb().prepare(`UPDATE bot_connections SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  audit(auditActor(gate.auth.username), "bot_connection_update", id, body);
  return NextResponse.json({
    success: true,
    connection: listBotConnections(filterUserId).find((connection) => connection.id === id),
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "bot_connection_delete" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  const result = filterUserId !== null
    ? getDb().prepare("DELETE FROM bot_connections WHERE id = ? AND (user_id = ? OR user_id IS NULL)").run(id, filterUserId)
    : getDb().prepare("DELETE FROM bot_connections WHERE id = ?").run(id);
  if (result.changes === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  audit(auditActor(gate.auth.username), "bot_connection_delete", id);
  return NextResponse.json({ success: true });
}
