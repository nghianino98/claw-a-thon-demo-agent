import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { audit, auditActor } from "@/lib/audit";
import { clientIp } from "@/lib/auth/ip";
import { hashPassword, validatePasswordPolicy, verifyPassword } from "@/lib/auth/password";
import { issueCsrf } from "@/lib/auth/csrf";
import {
  DEFAULT_MENUS,
  cookieName,
  createSession,
  destroySessionByRawToken,
  getAuthContext,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { generateBase32Secret, otpauthUrl, verifyTOTP } from "@/lib/auth/totp";
import { decrypt, encrypt } from "@/lib/crypto";
import { getDb } from "@/lib/db";
import { minutes, now } from "@/lib/time";

export const runtime = "nodejs";

type UserRow = {
  id: number;
  username: string;
  passwordHash: string;
  role: "superadmin" | "operator" | "viewer";
  status: "active" | "disabled";
  totpSecret: Buffer | string | null;
  mustChangePassword: number;
  failedAttempts: number;
  lockedUntil: number | null;
  menuPermissions?: string | null;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function usernameHash(username: string) {
  return crypto.createHash("sha256").update(username.toLowerCase()).digest("hex");
}

function getUser(username: string) {
  return getDb()
    .prepare(
      `
      SELECT id, username, password_hash as passwordHash, role, status, totp_secret as totpSecret,
             must_change_password as mustChangePassword, failed_attempts as failedAttempts,
             locked_until as lockedUntil, menu_permissions as menuPermissions
      FROM admin_users
      WHERE username = ?
    `,
    )
    .get(username) as UserRow | undefined;
}

function recordLoginFailure(username: string, ip: string, reason: string, user?: UserRow) {
  const t = now();
  getDb()
    .prepare("INSERT INTO login_failures (username_hash, ip, reason, created_at) VALUES (?, ?, ?, ?)")
    .run(username ? usernameHash(username) : null, ip || null, reason, t);

  if (user) {
    const failedAttempts = user.failedAttempts + 1;
    const lockedUntil = failedAttempts >= 5 ? t + minutes(15) : user.lockedUntil;
    getDb()
      .prepare("UPDATE admin_users SET failed_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?")
      .run(failedAttempts, lockedUntil, t, user.id);
  }
}

function ipFailureLimited(ip: string) {
  if (!ip) return false;
  const count = (
    getDb()
      .prepare("SELECT COUNT(*) as count FROM login_failures WHERE ip = ? AND created_at >= ?")
      .get(ip, now() - minutes(15)) as { count: number }
  ).count;
  return count >= 10;
}

function invalidCredentials(status = 401) {
  return NextResponse.json({ error: "invalid_credentials" }, { status });
}

async function login(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const otp = body.otp ? String(body.otp) : "";
  const ip = clientIp(request);
  const userAgent = request.headers.get("user-agent");

  if (!username || !password) {
    await sleep(1000);
    return invalidCredentials();
  }
  if (ipFailureLimited(ip)) {
    await sleep(1000);
    return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
  }

  const user = getUser(username);
  const passwordOk = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !passwordOk || user.status !== "active") {
    recordLoginFailure(username, ip, user ? "bad_password_or_disabled" : "unknown_user", user);
    audit("system", "login_fail", username, { reason: "invalid_credentials" }, { ip, userAgent });
    await sleep(1000);
    return invalidCredentials();
  }

  if (user.lockedUntil && user.lockedUntil > now()) {
    audit("system", "login_fail", username, { reason: "locked" }, { ip, userAgent });
    await sleep(1000);
    return NextResponse.json({ error: "locked", lockedUntil: user.lockedUntil }, { status: 423 });
  }

  if (user.totpSecret) {
    if (!otp) return NextResponse.json({ requiresOtp: true });
    const encrypted = Buffer.isBuffer(user.totpSecret) ? user.totpSecret : Buffer.from(user.totpSecret);
    const secret = decrypt(encrypted, "totp-secret");
    if (!verifyTOTP(secret, otp)) {
      recordLoginFailure(username, ip, "bad_otp", user);
      audit("system", "login_fail", username, { reason: "bad_otp" }, { ip, userAgent });
      await sleep(1000);
      return invalidCredentials();
    }
  }

  const rawSession = createSession(user.id, request);
  const tokenHash = crypto.createHash("sha256").update(rawSession).digest("hex");
  getDb()
    .prepare(
      "UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = ?, last_login_ip = ?, updated_at = ? WHERE id = ?",
    )
    .run(now(), ip || null, now(), user.id);

  audit(auditActor(user.username), "login_ok", user.username, undefined, { ip, userAgent });

  let parsedPermissions = DEFAULT_MENUS;
  if (user.menuPermissions !== null && user.menuPermissions !== undefined) {
    try {
      parsedPermissions = JSON.parse(user.menuPermissions);
    } catch (e) {
      parsedPermissions = [];
    }
  }

  const response = NextResponse.json({
    success: true,
    nextStep: "app",
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      mustChangePassword: Boolean(user.mustChangePassword),
      hasTotp: Boolean(user.totpSecret),
      menuPermissions: parsedPermissions,
    },
    csrfToken: issueCsrf(tokenHash),
  });
  response.cookies.set(cookieName(), rawSession, sessionCookieOptions());
  return response;
}

async function logout(request: NextRequest) {
  const raw = request.cookies.get(cookieName())?.value;
  const auth = getAuthContext(request);
  if (raw) destroySessionByRawToken(raw);
  if (auth) audit(auditActor(auth.username), "logout", auth.username);
  const response = NextResponse.json({ success: true });
  response.cookies.set(cookieName(), "", { ...sessionCookieOptions(), maxAge: 0 });
  return response;
}

async function changePassword(request: NextRequest) {
  const auth = getAuthContext(request);
  if (!auth?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const currentPassword = String(body.currentPassword || "");
  const newPassword = String(body.newPassword || "");
  if (!validatePasswordPolicy(newPassword)) {
    return NextResponse.json({ error: "password_policy" }, { status: 400 });
  }

  const row = getDb()
    .prepare("SELECT password_hash as passwordHash FROM admin_users WHERE id = ?")
    .get(auth.userId) as { passwordHash: string } | undefined;
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  getDb()
    .prepare("UPDATE admin_users SET password_hash = ?, must_change_password = 0, updated_at = ? WHERE id = ?")
    .run(await hashPassword(newPassword), now(), auth.userId);
  audit(auditActor(auth.username), "password_change", auth.username);
  return NextResponse.json({ success: true });
}

async function startTotp(request: NextRequest) {
  const auth = getAuthContext(request);
  if (!auth?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const secret = generateBase32Secret();
  return NextResponse.json({
    secret,
    otpauthUrl: otpauthUrl(auth.username, secret),
  });
}

async function verifyTotp(request: NextRequest) {
  const auth = getAuthContext(request);
  if (!auth?.userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const secret = String(body.secret || "");
  const otp = String(body.otp || "");
  if (!secret || !verifyTOTP(secret, otp)) {
    return NextResponse.json({ error: "invalid_otp" }, { status: 400 });
  }

  getDb()
    .prepare("UPDATE admin_users SET totp_secret = ?, updated_at = ? WHERE id = ?")
    .run(encrypt(secret, "totp-secret"), now(), auth.userId);
  audit(auditActor(auth.username), "totp_enable", auth.username);
  return NextResponse.json({ success: true });
}

export async function POST(request: NextRequest, context: { params: Promise<{ action: string[] }> }) {
  const { action } = await context.params;
  const key = action.join("/");

  if (key === "login") return login(request);
  if (key === "logout") return logout(request);
  if (key === "change-password") return changePassword(request);
  if (key === "setup-2fa/start") return startTotp(request);
  if (key === "setup-2fa/verify") return verifyTotp(request);

  return NextResponse.json({ error: "not_found" }, { status: 404 });
}
