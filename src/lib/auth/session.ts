import crypto from "crypto";
import type { NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { clientIp } from "@/lib/auth/ip";
import { hours, minutes, now } from "@/lib/time";
import type { Role } from "@/lib/rbac/roles";

export type AuthContext = {
  kind: "local" | "session" | "token";
  userId: number | null;
  username: string;
  role: Role;
  tokenHash: string | null;
  csrfRequired: boolean;
  mustChangePassword?: boolean;
  hasTotp?: boolean;
};

const SESSION_COOKIE = "qs_session";
const TOUCH_INTERVAL_MS = 60_000;

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function cookieName() {
  return SESSION_COOKIE;
}

function ttlMs() {
  return hours(Number(process.env.DIDI_SESSION_TTL_HOURS || 12));
}

function idleMs() {
  return minutes(Number(process.env.DIDI_SESSION_IDLE_MINUTES || 60));
}

export function getSessionByRawToken(rawToken: string): AuthContext | null {
  const tokenHash = hashToken(rawToken);
  const t = now();
  const row = getDb()
    .prepare(
      `
      SELECT
        s.token_hash as tokenHash,
        s.user_id as userId,
        s.last_seen_at as lastSeenAt,
        u.username,
        u.role,
        u.status,
        u.must_change_password as mustChangePassword,
        u.totp_secret as totpSecret
      FROM admin_sessions s
      JOIN admin_users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND s.expires_at > ?
        AND (s.last_seen_at + ?) > ?
        AND u.status = 'active'
    `,
    )
    .get(tokenHash, t, idleMs(), t) as
    | {
        tokenHash: string;
        userId: number;
        lastSeenAt: number;
        username: string;
        role: Role;
        mustChangePassword: number;
        totpSecret: string | null;
      }
    | undefined;

  if (!row) return null;

  if (t - row.lastSeenAt > TOUCH_INTERVAL_MS) {
    getDb().prepare("UPDATE admin_sessions SET last_seen_at = ? WHERE token_hash = ?").run(t, tokenHash);
  }

  return {
    kind: "session",
    userId: row.userId,
    username: row.username,
    role: row.role,
    tokenHash: row.tokenHash,
    csrfRequired: true,
    mustChangePassword: Boolean(row.mustChangePassword),
    hasTotp: Boolean(row.totpSecret),
  };
}

export function getTokenAuth(rawToken: string): AuthContext | null {
  const tokenHash = hashToken(rawToken);
  const t = now();
  const row = getDb()
    .prepare(
      `
      SELECT
        tok.id as tokenId,
        tok.user_id as userId,
        u.username,
        u.role,
        u.status,
        u.must_change_password as mustChangePassword,
        u.totp_secret as totpSecret
      FROM admin_tokens tok
      JOIN admin_users u ON u.id = tok.user_id
      WHERE tok.token_hash = ?
        AND tok.expires_at > ?
        AND tok.revoked = 0
        AND u.status = 'active'
    `,
    )
    .get(tokenHash, t) as
    | {
        tokenId: number;
        userId: number;
        username: string;
        role: Role;
        mustChangePassword: number;
        totpSecret: string | null;
      }
    | undefined;

  if (!row) return null;

  getDb().prepare("UPDATE admin_tokens SET last_used_at = ? WHERE id = ?").run(t, row.tokenId);
  return {
    kind: "token",
    userId: row.userId,
    username: row.username,
    role: row.role,
    tokenHash,
    csrfRequired: false,
    mustChangePassword: Boolean(row.mustChangePassword),
    hasTotp: Boolean(row.totpSecret),
  };
}

export function getAuthContext(request: NextRequest): AuthContext | null {
  if ((process.env.AUTH_MODE || "off") === "off") {
    return {
      kind: "local",
      userId: null,
      username: "local",
      role: "superadmin",
      tokenHash: null,
      csrfRequired: false,
    };
  }

  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ")) {
    return getTokenAuth(bearer.slice("Bearer ".length).trim());
  }

  const rawSession = request.cookies.get(SESSION_COOKIE)?.value;
  return rawSession ? getSessionByRawToken(rawSession) : null;
}

export function createSession(userId: number, request: NextRequest) {
  const raw = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(raw);
  const t = now();
  getDb()
    .prepare(
      `
      INSERT INTO admin_sessions (token_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    )
    .run(tokenHash, userId, t, t + ttlMs(), t, clientIp(request) || null, request.headers.get("user-agent"));
  return raw;
}

export function destroySessionByRawToken(rawToken: string) {
  getDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hashToken(rawToken));
}

export function destroySessionByHash(tokenHash: string) {
  getDb().prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(tokenHash);
}

export function destroyAllSessions(userId: number) {
  getDb().prepare("DELETE FROM admin_sessions WHERE user_id = ?").run(userId);
}

function secureCookiesEnabled() {
  if (process.env.DIDI_COOKIE_SECURE) {
    return process.env.DIDI_COOKIE_SECURE === "true";
  }
  return process.env.NODE_ENV === "production";
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: secureCookiesEnabled(),
    sameSite: "strict" as const,
    path: "/",
    maxAge: Math.floor(ttlMs() / 1000),
  };
}
