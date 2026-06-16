import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { hashPasswordSync, validatePasswordPolicy } from "@/lib/auth/password";
import { requireDidiAccess } from "@/lib/api/guard";
import { getDb } from "@/lib/db";
import { isRole } from "@/lib/rbac/roles";
import type { Role } from "@/lib/rbac/roles";
import { now } from "@/lib/time";
import { DEFAULT_MENUS } from "@/lib/auth/session";

export const runtime = "nodejs";

type AdminUserRecord = {
  id: number | bigint;
  username: string;
  role: Role;
  status: string;
  totp_secret?: unknown;
  must_change_password: number;
  failed_attempts: number;
  locked_until: number | null;
  last_login_at: number | null;
  last_login_ip: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  menu_permissions?: string | null;
};

function publicUser(row: AdminUserRecord) {
  let parsedPermissions: string[] = DEFAULT_MENUS;
  if (row.menu_permissions !== null && row.menu_permissions !== undefined) {
    try {
      parsedPermissions = JSON.parse(row.menu_permissions);
    } catch (e) {
      parsedPermissions = [];
    }
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    status: row.status,
    hasTotp: Boolean(row.totp_secret),
    mustChangePassword: Boolean(row.must_change_password),
    failedAttempts: row.failed_attempts,
    lockedUntil: row.locked_until,
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    menuPermissions: parsedPermissions,
  };
}

export async function GET(request: NextRequest) {
  const gate = requireDidiAccess(request, "superadmin", { action: "accounts_list" });
  if (!gate.ok) return gate.response;

  const users = getDb()
    .prepare("SELECT * FROM admin_users ORDER BY id ASC")
    .all() as AdminUserRecord[];
  return NextResponse.json({ users: users.map(publicUser) });
}

export async function POST(request: NextRequest) {
  const gate = requireDidiAccess(request, "superadmin", { csrf: true, action: "account_create" });
  if (!gate.ok) return gate.response;

  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  const role = body.role || "viewer";
  const password = body.password || crypto.randomBytes(12).toString("base64url");

  if (!/^[a-z0-9._-]{3,32}$/i.test(username)) {
    return NextResponse.json({ error: "invalid_username" }, { status: 400 });
  }
  if (!isRole(role)) return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  if (!validatePasswordPolicy(password)) return NextResponse.json({ error: "password_policy" }, { status: 400 });

  const t = now();
  let menuPermissionsVal: string | null = null;
  if (body.menuPermissions && Array.isArray(body.menuPermissions)) {
    const isValid = body.menuPermissions.every((item: unknown) => typeof item === "string");
    if (!isValid) return NextResponse.json({ error: "invalid_menu_permissions" }, { status: 400 });
    menuPermissionsVal = JSON.stringify(body.menuPermissions);
  }

  try {
    const result = getDb()
      .prepare(
        `
        INSERT INTO admin_users (
          username, password_hash, role, status, must_change_password, failed_attempts,
          created_by, created_at, updated_at, menu_permissions
        ) VALUES (?, ?, ?, 'active', 1, 0, ?, ?, ?, ?)
      `,
      )
      .run(username, hashPasswordSync(password), role, gate.auth.username, t, t, menuPermissionsVal);
    audit(auditActor(gate.auth.username), "account_create", username, { role });
    return NextResponse.json({
      success: true,
      user: publicUser({
        id: result.lastInsertRowid,
        username,
        role,
        status: "active",
        totp_secret: null,
        must_change_password: 1,
        failed_attempts: 0,
        locked_until: null,
        last_login_at: null,
        last_login_ip: null,
        created_by: gate.auth.username,
        created_at: t,
        updated_at: t,
        menu_permissions: menuPermissionsVal,
      }),
      temporaryPassword: body.password ? undefined : password,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message.includes("UNIQUE")) {
      return NextResponse.json({ error: "username_exists" }, { status: 409 });
    }
    throw error;
  }
}
