const Database = require("better-sqlite3");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

function hashPasswordSync(password) {
  const salt = crypto.randomBytes(16).toString("base64");
  const derived = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("base64")}`;
}

const dbPath = path.join(__dirname, "..", "data", "didi.sqlite3");
console.log("Database path:", dbPath);

if (!fs.existsSync(dbPath)) {
  console.error("Database file not found at " + dbPath);
  process.exit(1);
}

const db = new Database(dbPath);

// Retrieve DIDI_BOOTSTRAP_PASSWORD from .env
const envPath = path.join(__dirname, "..", ".env");
let bootstrapPassword = "adminpassword"; // default fallback

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf-8");
  const match = envContent.match(/^DIDI_BOOTSTRAP_PASSWORD=(.+)$/m);
  if (match && match[1]) {
    bootstrapPassword = match[1].trim();
  }
}

console.log("Using bootstrap password:", bootstrapPassword);

const newHash = hashPasswordSync(bootstrapPassword);
const now = Date.now();

try {
  const result = db.prepare(`
    UPDATE admin_users
    SET password_hash = ?,
        totp_secret = NULL,
        failed_attempts = 0,
        locked_until = NULL,
        must_change_password = 1,
        updated_at = ?
    WHERE username = 'admin'
  `).run(newHash, now);

  if (result.changes > 0) {
    console.log("Successfully reset admin account!");
    console.log("- Password has been reset to the one defined in .env (or 'adminpassword')");
    console.log("- TOTP 2FA has been cleared (set to NULL)");
    console.log("- Failed attempts and lock status have been reset");
    console.log("- must_change_password set to 1 (you will be prompted to change password and re-setup 2FA upon login)");
  } else {
    console.warn("No 'admin' user found in the database. Creating one...");
    db.prepare(`
      INSERT INTO admin_users (
        username, password_hash, role, status, totp_secret, must_change_password, failed_attempts,
        created_by, created_at, updated_at
      ) VALUES ('admin', ?, 'superadmin', 'active', NULL, 1, 0, 'system', ?, ?)
    `).run(newHash, now, now);
    console.log("Created a new 'admin' user successfully!");
  }
} catch (error) {
  console.error("Failed to reset admin account:", error);
} finally {
  db.close();
}
