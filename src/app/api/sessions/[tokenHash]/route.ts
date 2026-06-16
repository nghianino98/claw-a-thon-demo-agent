import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { destroySessionByHash } from "@/lib/auth/session";
import { requireDidiAccess } from "@/lib/api/guard";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ tokenHash: string }> }) {
  const gate = requireDidiAccess(request, "viewer", { csrf: true, action: "session_revoke" });
  if (!gate.ok) return gate.response;
  const { tokenHash } = await context.params;
  const row = getDb()
    .prepare("SELECT user_id as userId FROM admin_sessions WHERE token_hash = ?")
    .get(tokenHash) as { userId: number } | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gate.auth.role !== "superadmin" && row.userId !== gate.auth.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  destroySessionByHash(tokenHash);
  audit(auditActor(gate.auth.username), "session_revoke", tokenHash.slice(0, 12));
  return NextResponse.json({ success: true });
}
