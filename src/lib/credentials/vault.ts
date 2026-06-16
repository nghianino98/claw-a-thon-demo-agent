import { getDb } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { now } from "@/lib/time";

export type CredentialSource = "confluence" | "jira" | "gitlab";

export type CredentialRef = {
  source: CredentialSource;
  label?: string;
};

export type ResolvedCredential = {
  username: string;
  token: string;
  credentialId?: number;
};

export function listCredentials(userId: number) {
  return getDb()
    .prepare(
      `
      SELECT id, user_id as userId, source, label, username, created_at as createdAt,
             updated_at as updatedAt, last_used_at as lastUsedAt, revoked
      FROM credentials
      WHERE user_id = ?
      ORDER BY source, label
    `,
    )
    .all(userId);
}

export function upsertCredential(input: {
  userId: number;
  source: CredentialSource;
  label?: string;
  username: string;
  token: string;
}) {
  const label = input.label || "default";
  const t = now();
  const tokenEncrypted = encrypt(input.token, "cred-vault");
  getDb()
    .prepare(
      `
      INSERT INTO credentials (user_id, source, label, username, token_encrypted, created_at, updated_at, revoked)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(user_id, source, label)
      DO UPDATE SET username = excluded.username,
                    token_encrypted = excluded.token_encrypted,
                    updated_at = excluded.updated_at,
                    revoked = 0
    `,
    )
    .run(input.userId, input.source, label, input.username, tokenEncrypted, t, t);
}

export function revokeCredential(id: number, requesterUserId: number, isSuperadmin: boolean) {
  const row = getDb()
    .prepare("SELECT user_id as userId FROM credentials WHERE id = ?")
    .get(id) as { userId: number } | undefined;
  if (!row) return false;
  if (!isSuperadmin && row.userId !== requesterUserId) return false;
  getDb().prepare("UPDATE credentials SET revoked = 1, updated_at = ? WHERE id = ?").run(now(), id);
  return true;
}

export function resolveCredential(input: {
  ref?: CredentialRef;
  actorUserId?: number | null;
  scheduleOwnerUserId?: number | null;
  legacyUsername?: string;
  legacyApiKey?: string;
  mode?: string;
}): ResolvedCredential {
  const mode = input.mode || process.env.AUTH_MODE || "off";

  if (mode !== "required") {
    if (input.legacyApiKey) {
      return {
        username: input.legacyUsername || "",
        token: input.legacyApiKey,
      };
    }
    const envToken =
      process.env.CONFLUENCE_API_KEY || process.env.JIRA_API_KEY || process.env.GITLAB_PRIVATE_TOKEN;
    if (envToken) {
      return {
        username: input.legacyUsername || process.env.CONFLUENCE_USERNAME || process.env.JIRA_USERNAME || "",
        token: envToken,
      };
    }
  }

  if (!input.ref) throw new Error("credentialRef is required in server mode");
  const ownerUserId = input.scheduleOwnerUserId || input.actorUserId;
  if (!ownerUserId) throw new Error("credential owner is required");

  const row = getDb()
    .prepare(
      `
      SELECT id, username, token_encrypted as tokenEncrypted
      FROM credentials
      WHERE user_id = ? AND source = ? AND label = ? AND revoked = 0
    `,
    )
    .get(ownerUserId, input.ref.source, input.ref.label || "default") as
    | { id: number; username: string; tokenEncrypted: Buffer }
    | undefined;

  if (!row) throw new Error("credential not found or revoked");
  getDb().prepare("UPDATE credentials SET last_used_at = ? WHERE id = ?").run(now(), row.id);

  return {
    username: row.username,
    token: decrypt(row.tokenEncrypted, "cred-vault"),
    credentialId: row.id,
  };
}

export function maskTaskSecrets<T extends Record<string, unknown>>(task: T): T {
  if (!task || typeof task !== "object") return task;
  if (!("apiKey" in task)) return task;
  return { ...task, apiKey: task.apiKey ? "[redacted]" : "" };
}
