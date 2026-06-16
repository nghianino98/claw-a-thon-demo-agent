import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { encryptAgentSecret, listAgentConnections, markOnlyDefault, normalizeAgentConnectionId, normalizeBaseUrl } from "@/lib/agent-connections";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type ConnectionBody = {
  id?: unknown;
  name?: unknown;
  baseUrl?: unknown;
  base_url?: unknown;
  apiKey?: unknown;
  api_key?: unknown;
  adminToken?: unknown;
  admin_token?: unknown;
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

export async function GET(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { action: "agent_connections_list" });
  if (!gate.ok) return gate.response;

  return NextResponse.json({ connections: listAgentConnections() });
}

export async function POST(request: NextRequest) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "agent_connection_create" });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as ConnectionBody;
  const id = normalizeAgentConnectionId(asString(body.id));
  const name = asString(body.name);
  const baseUrlInput = asString(body.baseUrl ?? body.base_url);
  const apiKey = asString(body.apiKey ?? body.api_key);
  const adminToken = asString(body.adminToken ?? body.admin_token);
  const enabled = asBool(body.enabled, true);
  const isDefault = asBool(body.isDefault ?? body.is_default);

  if (!id || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });

  let baseUrl: string;
  try {
    baseUrl = normalizeBaseUrl(baseUrlInput);
  } catch {
    return NextResponse.json({ error: "invalid_base_url" }, { status: 400 });
  }

  let apiKeyEncrypted: Buffer | null = null;
  let adminTokenEncrypted: Buffer | null = null;
  try {
    apiKeyEncrypted = apiKey ? encryptAgentSecret(apiKey) : null;
    adminTokenEncrypted = adminToken ? encryptAgentSecret(adminToken) : null;
  } catch (error) {
    return NextResponse.json({ error: "secret_storage_not_configured", message: (error as Error).message }, { status: 400 });
  }

  const t = now();
  try {
    getDb()
      .prepare(
        `
        INSERT INTO agent_connections (
          id, name, base_url, api_key_encrypted, admin_token_encrypted,
          enabled, is_default, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)
      `,
      )
      .run(id, name, baseUrl, apiKeyEncrypted, adminTokenEncrypted, enabled ? 1 : 0, isDefault ? 1 : 0, t, t);
    if (isDefault) markOnlyDefault(id);
    audit(auditActor(gate.auth.username), "agent_connection_create", id, { name, baseUrl, enabled, isDefault });
    return NextResponse.json({ success: true, connection: listAgentConnections().find((connection) => connection.id === id) });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "connection_exists" }, { status: 409 });
    }
    throw error;
  }
}
