import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { hashToken } from "@/lib/auth/session";
import { requireDidiAccess } from "@/lib/api/guard";
import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

export const runtime = "nodejs";

const MAX_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { action: "tokens_list" });
  if (!gate.ok) return gate.response;
  const rows = getDb()
    .prepare(
      `
      SELECT id, name, expires_at as expiresAt, last_used_at as lastUsedAt, revoked, created_at as createdAt
      FROM admin_tokens
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
    )
    .all(gate.auth.userId);
  return NextResponse.json({ tokens: rows });
}

export async function POST(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { csrf: true, action: "token_create" });
  if (!gate.ok) return gate.response;
  if (!gate.auth.userId) return NextResponse.json({ error: "local_mode_unsupported" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const name = String(body.name || "").trim();
  if (!name) return NextResponse.json({ error: "name_required" }, { status: 400 });
  const requestedExpiresAt = Number(body.expiresAt || 0);
  const t = now();
  const expiresAt =
    requestedExpiresAt && requestedExpiresAt > t
      ? Math.min(requestedExpiresAt, t + MAX_TOKEN_TTL_MS)
      : t + MAX_TOKEN_TTL_MS;
  const token = `dpat_${crypto.randomBytes(32).toString("base64url")}`;
  getDb()
    .prepare(
      "INSERT INTO admin_tokens (user_id, name, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(gate.auth.userId, name, hashToken(token), expiresAt, t);
  audit(auditActor(gate.auth.username), "token_create", name);
  return NextResponse.json({ success: true, token, expiresAt });
}
