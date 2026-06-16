import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "viewer", { csrf: true, action: "token_revoke" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const tokenId = Number(id);
  const row = getDb()
    .prepare("SELECT user_id as userId, name FROM admin_tokens WHERE id = ?")
    .get(tokenId) as { userId: number; name: string } | undefined;
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (gate.auth.role !== "superadmin" && row.userId !== gate.auth.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  getDb().prepare("UPDATE admin_tokens SET revoked = 1 WHERE id = ?").run(tokenId);
  audit(auditActor(gate.auth.username), "token_revoke", row.name);
  return NextResponse.json({ success: true });
}
