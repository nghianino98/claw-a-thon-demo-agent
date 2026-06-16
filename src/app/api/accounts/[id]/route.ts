import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { hashPasswordSync, validatePasswordPolicy } from "@/lib/auth/password";
import { destroyAllSessions } from "@/lib/auth/session";
import { requireDidiAccess } from "@/lib/api/guard";
import { getDb } from "@/lib/db";
import { isRole } from "@/lib/rbac/roles";
import { now } from "@/lib/time";

export const runtime = "nodejs";

type AccountPatchBody = {
  role?: unknown;
  status?: unknown;
  resetPassword?: boolean;
  password?: string;
  resetTotp?: boolean;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const gate = requireDidiAccess(request, "superadmin", { csrf: true, action: "account_update" });
  if (!gate.ok) return gate.response;
  const { id } = await context.params;
  const userId = Number(id);
  if (!Number.isInteger(userId)) return NextResponse.json({ error: "invalid_id" }, { status: 400 });

  const body = (await request.json().catch(() => ({}))) as AccountPatchBody;
  const sets: string[] = [];
  const values: unknown[] = [];
  let temporaryPassword: string | undefined;

  if (body.role !== undefined) {
    if (!isRole(body.role)) return NextResponse.json({ error: "invalid_role" }, { status: 400 });
    sets.push("role = ?");
    values.push(body.role);
  }
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "disabled") {
      return NextResponse.json({ error: "invalid_status" }, { status: 400 });
    }
    sets.push("status = ?");
    values.push(body.status);
    if (body.status === "disabled") destroyAllSessions(userId);
  }
  if (body.resetPassword) {
    const password = body.password || crypto.randomBytes(12).toString("base64url");
    if (!validatePasswordPolicy(password)) return NextResponse.json({ error: "password_policy" }, { status: 400 });
    sets.push("password_hash = ?", "must_change_password = 1", "failed_attempts = 0", "locked_until = NULL");
    values.push(hashPasswordSync(password));
    temporaryPassword = body.password ? undefined : password;
    destroyAllSessions(userId);
  }
  if (body.resetTotp) {
    sets.push("totp_secret = NULL");
    destroyAllSessions(userId);
  }

  if (sets.length === 0) return NextResponse.json({ error: "no_changes" }, { status: 400 });

  sets.push("updated_at = ?");
  values.push(now(), userId);
  getDb().prepare(`UPDATE admin_users SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  audit(auditActor(gate.auth.username), "account_update", String(userId), {
    role: body.role,
    status: body.status,
    resetPassword: Boolean(body.resetPassword),
    resetTotp: Boolean(body.resetTotp),
  });
  return NextResponse.json({ success: true, temporaryPassword });
}
