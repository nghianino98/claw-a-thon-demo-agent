import { getDb } from "@/lib/db";

export const authMode = () => process.env.AUTH_MODE || "off";

export const isAuthRequired = () => authMode() === "required";

export function assertServerModeEnv() {
  if (!isAuthRequired()) return;

  const appSecret = process.env.DIDI_APP_SECRET;
  if (!appSecret || appSecret.length < 32) {
    throw new Error("DIDI_APP_SECRET must be at least 32 characters when AUTH_MODE=required");
  }

  if (process.env.AGENT_ADMIN_TOKEN) {
    if (process.env.AGENT_ADMIN_TOKEN.length < 32) {
      throw new Error("AGENT_ADMIN_TOKEN must be at least 32 characters");
    }
  }
  if (process.env.AGENT_API_KEY && process.env.AGENT_API_KEY.length < 32) {
    throw new Error("AGENT_API_KEY must be at least 32 characters");
  }

  // Optional KB sync feature (POST /api/knowledge-base/push-to-agent). When the key is set,
  // it must be strong and have a base URL to push to; absence simply disables the feature.
  const syncKey = process.env.AGENT_SYNC_API_KEY;
  if (syncKey) {
    if (syncKey.length < 32) {
      throw new Error("AGENT_SYNC_API_KEY must be at least 32 characters");
    }
    if (!process.env.AGENT_BASE_URL) {
      throw new Error("AGENT_BASE_URL is required when AGENT_SYNC_API_KEY is set");
    }
  }
}

export function assertBootstrapEnvIfNeeded() {
  if (!isAuthRequired()) return;

  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) AS count FROM admin_users").get() as { count: number };
  if (row.count > 0) return;

  const user = process.env.DIDI_BOOTSTRAP_USER;
  const password = process.env.DIDI_BOOTSTRAP_PASSWORD;
  if (!user || !password || password.length < 12) {
    throw new Error(
      "DIDI_BOOTSTRAP_USER and DIDI_BOOTSTRAP_PASSWORD (>=12 chars) are required for first server-mode boot",
    );
  }
}
