import { NextRequest, NextResponse } from "next/server";
import { requireDidiAccess } from "@/lib/api/guard";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { action: "sessions_list" });
  if (!gate.ok) return gate.response;

  const all = request.nextUrl.searchParams.get("all") === "1" && gate.auth.role === "superadmin";
  const rows = all
    ? getDb()
        .prepare(
          `
          SELECT s.token_hash as tokenHash, s.user_id as userId, u.username,
                 s.created_at as createdAt, s.expires_at as expiresAt,
                 s.last_seen_at as lastSeenAt, s.ip, s.user_agent as userAgent
          FROM admin_sessions s JOIN admin_users u ON u.id = s.user_id
          ORDER BY s.last_seen_at DESC
        `,
        )
        .all()
    : getDb()
        .prepare(
          `
          SELECT token_hash as tokenHash, user_id as userId, created_at as createdAt, expires_at as expiresAt,
                 last_seen_at as lastSeenAt, ip, user_agent as userAgent
          FROM admin_sessions
          WHERE user_id = ?
          ORDER BY last_seen_at DESC
        `,
        )
        .all(gate.auth.userId);

  return NextResponse.json({ sessions: rows });
}
