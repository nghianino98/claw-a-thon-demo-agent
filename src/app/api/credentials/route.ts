import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { requireDidiAccess } from "@/lib/api/guard";
import { listCredentials, upsertCredential, type CredentialSource } from "@/lib/credentials/vault";

export const runtime = "nodejs";

function isSource(source: unknown): source is CredentialSource {
  return source === "confluence" || source === "jira" || source === "gitlab";
}

export async function GET(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { action: "credentials_list" });
  if (!gate.ok) return gate.response;
  if (!gate.auth.userId) return NextResponse.json({ credentials: [] });
  return NextResponse.json({ credentials: listCredentials(gate.auth.userId) });
}

export async function POST(request: NextRequest) {
  const gate = requireDidiAccess(request, "viewer", { csrf: true, action: "credential_upsert" });
  if (!gate.ok) return gate.response;
  if (!gate.auth.userId) return NextResponse.json({ error: "local_mode_unsupported" }, { status: 400 });
  const body = await request.json().catch(() => ({}));
  const source = body.source;
  const username = String(body.username || "").trim();
  const token = String(body.token || "");
  const label = String(body.label || "default").trim() || "default";
  if (!isSource(source)) return NextResponse.json({ error: "invalid_source" }, { status: 400 });
  if (!username || !token) return NextResponse.json({ error: "missing_fields" }, { status: 400 });
  upsertCredential({ userId: gate.auth.userId, source, label, username, token });
  audit(auditActor(gate.auth.username), "credential_upsert", `${source}:${label}`);
  return NextResponse.json({ success: true });
}
