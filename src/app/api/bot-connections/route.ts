import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import {
  encryptBotSecret,
  isBotPlatform,
  listBotConnections,
  normalizeBotConnectionId,
} from "@/lib/bot-connections";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type BotBody = {
  id?: unknown;
  platform?: unknown;
  name?: unknown;
  token?: unknown;
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

export async function GET(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { action: "bot_connections_list" });
  if (!gate.ok) return gate.response;
  const filterUserId = gate.auth.role === "superadmin" ? null : gate.auth.userId;
  return NextResponse.json({ connections: listBotConnections(filterUserId) });
}

export async function POST(request: NextRequest) {
  const gate = requireDidiAccess(request, "operator", { csrf: true, action: "bot_connection_create" });
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => ({}))) as BotBody;
  const platform = asString(body.platform);
  const name = asString(body.name);
  const token = asString(body.token);
  const agentConnectionId = asString(body.agentConnectionId ?? body.agent_connection_id);
  const enabled = asBool(body.enabled, true);
  const id = normalizeBotConnectionId(asString(body.id) || name);

  if (!isBotPlatform(platform)) return NextResponse.json({ error: "invalid_platform" }, { status: 400 });
  if (!id || !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(id)) {
    return NextResponse.json({ error: "invalid_id" }, { status: 400 });
  }
  if (!name) return NextResponse.json({ error: "invalid_name" }, { status: 400 });

  let tokenEncrypted: Buffer | null = null;
  try {
    tokenEncrypted = token ? encryptBotSecret(token) : null;
  } catch (error) {
    return NextResponse.json(
      { error: "secret_storage_not_configured", message: (error as Error).message },
      { status: 400 },
    );
  }

  const t = now();
  try {
    getDb()
      .prepare(
        `
        INSERT INTO bot_connections (
          id, platform, name, token_encrypted, agent_connection_id,
          enabled, status, created_at, updated_at, user_id
        ) VALUES (?, ?, ?, ?, ?, ?, 'unknown', ?, ?, ?)
      `,
      )
      .run(id, platform, name, tokenEncrypted, agentConnectionId || null, enabled ? 1 : 0, t, t, gate.auth.userId);
    audit(auditActor(gate.auth.username), "bot_connection_create", id, { platform, name, enabled });
    return NextResponse.json({
      success: true,
      connection: listBotConnections(gate.auth.userId).find((connection) => connection.id === id),
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "connection_exists" }, { status: 409 });
    }
    throw error;
  }
}
