import { getDb } from "@/lib/db";
import { now } from "@/lib/time";

const SECRET_KEYS = /token|key|secret|password|apiKey|api_key/i;

function sanitize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, val]) => [
      key,
      SECRET_KEYS.test(key) ? "[redacted]" : sanitize(val),
    ]),
  );
}

export function audit(
  actor: string,
  action: string,
  target?: string | null,
  detail?: unknown,
  meta?: { ip?: string | null; userAgent?: string | null },
) {
  try {
    getDb()
      .prepare(
        "INSERT INTO audit_log (actor, action, target, detail, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        actor,
        action,
        target || null,
        detail === undefined ? null : JSON.stringify(sanitize(detail)),
        meta?.ip || null,
        meta?.userAgent || null,
        now(),
      );
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}

export function auditActor(username?: string | null) {
  return username ? `didi:${username}` : "system";
}
