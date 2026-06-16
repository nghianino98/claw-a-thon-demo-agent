import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { revokeCredential } from "@/lib/credentials/vault";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "viewer", { csrf: true, action: "credential_revoke" });
  if (!gate.ok) return gate.response;
  if (!gate.auth.userId) return NextResponse.json({ error: "local_mode_unsupported" }, { status: 400 });
  const { id } = await context.params;
  const ok = revokeCredential(Number(id), gate.auth.userId, gate.auth.role === "superadmin");
  if (!ok) return NextResponse.json({ error: "not_found" }, { status: 404 });
  audit(auditActor(gate.auth.username), "credential_revoke", id);
  return NextResponse.json({ success: true });
}
