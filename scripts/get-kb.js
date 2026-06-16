const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const SECRET_INFO = "agent-connection";
const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const TAG_LEN = 16;

function deriveKey(info) {
  const secret = process.env.DIDI_APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("DIDI_APP_SECRET must be at least 32 characters");
  }
  return crypto.hkdfSync("sha256", secret, "", info, KEY_LEN);
}

function decrypt(buffer, info = "cred-vault") {
  const iv = buffer.subarray(0, IV_LEN);
  const tag = buffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buffer.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(info), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
}

// Read DIDI_APP_SECRET from .env
const envPath = path.join(__dirname, "..", ".env");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  envContent.split("\n").forEach((line) => {
    const parts = line.split("=");
    if (parts.length >= 2) {
      const k = parts[0].trim();
      const v = parts.slice(1).join("=").trim();
      process.env[k] = v;
    }
  });
}

const dbPath = path.join(__dirname, "..", "data", "didi.sqlite3");
const db = new Database(dbPath);

const row = db.prepare("SELECT * FROM agent_connections WHERE enabled = 1 ORDER BY is_default DESC LIMIT 1").get();
if (!row) {
  console.error("No active agent connection found in DB.");
  process.exit(1);
}

const adminToken = decrypt(row.admin_token_encrypted, SECRET_INFO);
const baseUrl = row.base_url;

console.log("Agent Base URL:", baseUrl);

async function run() {
  // Try to fetch manifest or similar endpoint
  const targetUrl = new URL("admin/api/kb/manifest", baseUrl).toString();
  console.log("Fetching KB manifest from:", targetUrl);
  
  // Try using X-Sync-Api-Key first if available
  const headers = {
    Authorization: `Bearer ${adminToken}`,
    "X-Acting-User": "admin",
    "X-Acting-Role": "superadmin",
  };
  
  if (process.env.AGENT_SYNC_API_KEY) {
    headers["X-Sync-Api-Key"] = process.env.AGENT_SYNC_API_KEY;
  }
  
  const response = await fetch(targetUrl, { headers });
  
  if (!response.ok) {
    console.error("Failed to fetch KB manifest:", response.status, await response.text());
    return;
  }
  
  const data = await response.json();
  console.log("Current KB manifest on production hosted agent:");
  console.log(JSON.stringify(data, null, 2));
}

run().catch(console.error);
