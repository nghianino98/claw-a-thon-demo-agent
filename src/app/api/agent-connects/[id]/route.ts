import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import {
  encryptAgentSecret,
  getAgentConnection,
  getAgentConnectionRow,
  listAgentConnections,
  markOnlyDefault,
  normalizeBaseUrl,
} from "@/lib/agent-connections";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type PatchBody = {
  name?: unknown;
  baseUrl?: unknown;
  base_url?: unknown;
  apiKey?: unknown;
  api_key?: unknown;
  adminToken?: unknown;
  admin_token?: unknown;
  clearApiKey?: unknown;
  clear_api_key?: unknown;
  clearAdminToken?: unknown;
  clear_admin_token?: unknown;
  enabled?: unknown;
  isDefault?: unknown;
  is_default?: unknown;
};

function asString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function asBool(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : value === 1 ? true : value === 0 ? false : fallback;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "viewer", { action: "agent_connection_read" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  const connection = getAgentConnection(id, filterUserId);
  if (!connection) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ connection });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "agent_connection_update" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  if (!getAgentConnectionRow(id, filterUserId)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as PatchBody;
  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.name !== undefined) {
    const name = asString(body.name);
    if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });
    sets.push("name = ?");
    values.push(name);
  }

  if (body.baseUrl !== undefined || body.base_url !== undefined) {
    try {
      sets.push("base_url = ?");
      values.push(normalizeBaseUrl(asString(body.baseUrl ?? body.base_url)));
    } catch {
      return NextResponse.json({ error: "invalid_base_url" }, { status: 400 });
    }
  }

  try {
    if (body.apiKey !== undefined || body.api_key !== undefined) {
      const apiKey = asString(body.apiKey ?? body.api_key);
      if (apiKey) {
        sets.push("api_key_encrypted = ?");
        values.push(encryptAgentSecret(apiKey));
      }
    }
    if (body.adminToken !== undefined || body.admin_token !== undefined) {
      const adminToken = asString(body.adminToken ?? body.admin_token);
      if (adminToken) {
        sets.push("admin_token_encrypted = ?");
        values.push(encryptAgentSecret(adminToken));
      }
    }
  } catch (error) {
    return NextResponse.json({ error: "secret_storage_not_configured", message: (error as Error).message }, { status: 400 });
  }

  if (asBool(body.clearApiKey ?? body.clear_api_key)) {
    sets.push("api_key_encrypted = NULL");
  }
  if (asBool(body.clearAdminToken ?? body.clear_admin_token)) {
    sets.push("admin_token_encrypted = NULL");
  }
  if (body.enabled !== undefined) {
    sets.push("enabled = ?");
    values.push(asBool(body.enabled) ? 1 : 0);
  }
  const isDefaultProvided = body.isDefault !== undefined || body.is_default !== undefined;
  const isDefault = asBool(body.isDefault ?? body.is_default);
  if (isDefaultProvided) {
    sets.push("is_default = ?");
    values.push(isDefault ? 1 : 0);
  }

  if (sets.length === 0) return NextResponse.json({ error: "no_changes" }, { status: 400 });

  sets.push("updated_at = ?");
  values.push(now());

  if (gate.auth.userId !== null && gate.auth.role !== "superadmin") {
    sets.push("user_id = ?");
    values.push(gate.auth.userId);
  }

  if (filterUserId !== null) {
    getDb().prepare(`UPDATE agent_connections SET ${sets.join(", ")} WHERE id = ? AND (user_id = ? OR user_id IS NULL)`).run(...values, id, filterUserId);
  } else {
    getDb().prepare(`UPDATE agent_connections SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  if (isDefaultProvided && isDefault) markOnlyDefault(id, filterUserId);
  audit(auditActor(gate.auth.username), "agent_connection_update", id, body);
  return NextResponse.json({ success: true, connection: listAgentConnections(filterUserId).find((connection) => connection.id === id) });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "agent_connection_delete" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  const result = filterUserId !== null
    ? getDb().prepare("DELETE FROM agent_connections WHERE id = ? AND (user_id = ? OR user_id IS NULL)").run(id, filterUserId)
    : getDb().prepare("DELETE FROM agent_connections WHERE id = ?").run(id);
  if (result.changes === 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  audit(auditActor(gate.auth.username), "agent_connection_delete", id);
  return NextResponse.json({ success: true });
}
