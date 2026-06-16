import type Database from "better-sqlite3";
import { now } from "@/lib/time";
import { hashPasswordSync } from "@/lib/auth/password";
import { encrypt } from "@/lib/crypto";

type Migration = {
  id: string;
  up: (db: Database.Database) => void;
};

const migrations: Migration[] = [
  {
    id: "0001_admin_platform",
    up(db) {
      db.exec(`
        PRAGMA journal_mode=WAL;
        PRAGMA foreign_keys=ON;

        CREATE TABLE IF NOT EXISTS schema_migrations (
          id TEXT PRIMARY KEY,
          applied_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT NOT NULL CHECK(role IN ('superadmin','operator','viewer')),
          status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
          totp_secret TEXT,
          must_change_password INTEGER NOT NULL DEFAULT 1,
          failed_attempts INTEGER NOT NULL DEFAULT 0,
          locked_until INTEGER,
          last_login_at INTEGER,
          last_login_ip TEXT,
          created_by TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS admin_sessions (
          token_hash TEXT PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          created_at INTEGER NOT NULL,
          expires_at INTEGER NOT NULL,
          last_seen_at INTEGER NOT NULL,
          ip TEXT,
          user_agent TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_sessions_user ON admin_sessions(user_id, expires_at);

        CREATE TABLE IF NOT EXISTS admin_tokens (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          token_hash TEXT UNIQUE NOT NULL,
          expires_at INTEGER NOT NULL,
          last_used_at INTEGER,
          revoked INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS credentials (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          user_id INTEGER NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
          source TEXT NOT NULL CHECK(source IN ('confluence','jira','gitlab')),
          label TEXT NOT NULL DEFAULT 'default',
          username TEXT NOT NULL,
          token_encrypted BLOB NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_used_at INTEGER,
          revoked INTEGER NOT NULL DEFAULT 0,
          UNIQUE(user_id, source, label)
        );
        CREATE INDEX IF NOT EXISTS idx_cred_owner ON credentials(user_id, source, label);

        CREATE TABLE IF NOT EXISTS audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          target TEXT,
          detail TEXT,
          ip TEXT,
          user_agent TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_audit_action_time ON audit_log(action, created_at);
        CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log(actor, created_at);

        CREATE TABLE IF NOT EXISTS login_failures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username_hash TEXT,
          ip TEXT,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_login_fail_ip ON login_failures(ip, created_at);
      `);
    },
  },
  {
    id: "0002_agent_connections",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS agent_connections (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          base_url TEXT NOT NULL,
          api_key_encrypted BLOB,
          admin_token_encrypted BLOB,
          enabled INTEGER NOT NULL DEFAULT 1,
          is_default INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','connected','error')),
          last_error TEXT,
          last_checked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_connections_enabled ON agent_connections(enabled, is_default);
      `);

      const existing = db.prepare("SELECT COUNT(*) AS count FROM agent_connections").get() as { count: number };
      const baseUrl = process.env.AGENT_BASE_URL?.trim();
      if (existing.count > 0 || !baseUrl) return;

      const id = (process.env.AGENT_CONNECTION_ID || "queo-solution-agent").trim();
      const name = (process.env.AGENT_CONNECTION_NAME || "Quéo Solution Agent").trim();
      const t = now();

      const maybeEncrypt = (value?: string) => {
        if (!value) return null;
        try {
          return encrypt(value, "agent-connection");
        } catch {
          return null;
        }
      };

      db.prepare(`
        INSERT INTO agent_connections (
          id, name, base_url, api_key_encrypted, admin_token_encrypted,
          enabled, is_default, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 1, 1, 'unknown', ?, ?)
      `).run(
        id,
        name,
        baseUrl,
        maybeEncrypt(process.env.AGENT_API_KEY),
        maybeEncrypt(process.env.AGENT_ADMIN_TOKEN),
        t,
        t,
      );
    },
  },
  {
    id: "0003_bot_connections",
    up(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS bot_connections (
          id TEXT PRIMARY KEY,
          platform TEXT NOT NULL CHECK(platform IN ('telegram','whatsapp','zalo')),
          name TEXT NOT NULL,
          token_encrypted BLOB,
          agent_connection_id TEXT,
          bot_username TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'unknown' CHECK(status IN ('unknown','connected','error')),
          last_error TEXT,
          last_checked_at INTEGER,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_bot_connections_platform ON bot_connections(platform, enabled);
      `);
    },
  },
  {
    id: "0004_user_isolation",
    up(db) {
      const hasAgentUserId = db.prepare("PRAGMA table_info(agent_connections)").all().some((col: any) => col.name === "user_id");
      if (!hasAgentUserId) {
        db.exec("ALTER TABLE agent_connections ADD COLUMN user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE");
      }
      const hasBotUserId = db.prepare("PRAGMA table_info(bot_connections)").all().some((col: any) => col.name === "user_id");
      if (!hasBotUserId) {
        db.exec("ALTER TABLE bot_connections ADD COLUMN user_id INTEGER REFERENCES admin_users(id) ON DELETE CASCADE");
      }

      const firstAdmin = db.prepare("SELECT id FROM admin_users ORDER BY id ASC LIMIT 1").get() as { id: number } | undefined;
      if (firstAdmin) {
        db.prepare("UPDATE agent_connections SET user_id = ? WHERE user_id IS NULL").run(firstAdmin.id);
        db.prepare("UPDATE bot_connections SET user_id = ? WHERE user_id IS NULL").run(firstAdmin.id);
      }
    },
  },
  {
    id: "0005_menu_permissions",
    up(db) {
      const hasMenuPermissions = db.prepare("PRAGMA table_info(admin_users)").all().some((col: any) => col.name === "menu_permissions");
      if (!hasMenuPermissions) {
        db.exec("ALTER TABLE admin_users ADD COLUMN menu_permissions TEXT");
      }
    },
  },
];

function seedBootstrapUser(db: Database.Database) {
  if ((process.env.AUTH_MODE || "off") !== "required") return;

  const username = process.env.DIDI_BOOTSTRAP_USER;
  const password = process.env.DIDI_BOOTSTRAP_PASSWORD;
  if (!username || !password || password.length < 12) {
    throw new Error(
      "DIDI_BOOTSTRAP_USER and DIDI_BOOTSTRAP_PASSWORD (>=12 chars) are required for first server-mode boot",
    );
  }

  const t = now();
  // Always upsert the bootstrap user so password stays in sync with env vars across deploys
  db.prepare(`
    INSERT INTO admin_users (
      username, password_hash, role, status, must_change_password, failed_attempts,
      created_by, created_at, updated_at
    ) VALUES (?, ?, 'superadmin', 'active', 0, 0, 'system', ?, ?)
    ON CONFLICT(username) DO UPDATE SET
      password_hash = excluded.password_hash,
      status = 'active',
      failed_attempts = 0,
      locked_until = NULL,
      must_change_password = 0,
      totp_secret = NULL,
      updated_at = excluded.updated_at
  `).run(username, hashPasswordSync(password), t, t);
}

export function runMigrations(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");

  const applied = db
    .prepare("SELECT id FROM schema_migrations")
    .all()
    .map((row) => (row as { id: string }).id);
  const appliedSet = new Set(applied);

  for (const migration of migrations) {
    if (appliedSet.has(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      db.prepare("INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)").run(migration.id, now());
    })();
  }

  seedBootstrapUser(db);
}
