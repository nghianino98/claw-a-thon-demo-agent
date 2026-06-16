import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;
const KEY_LEN = 32;
const TAG_LEN = 16;

function deriveKey(info: string): Buffer {
  const secret = process.env.DIDI_APP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("DIDI_APP_SECRET must be at least 32 characters");
  }
  return Buffer.from(crypto.hkdfSync("sha256", secret, "", info, KEY_LEN));
}

export function encrypt(text: string, info = "cred-vault"): Buffer {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, deriveKey(info), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]);
}

export function decrypt(buffer: Buffer, info = "cred-vault"): string {
  const iv = buffer.subarray(0, IV_LEN);
  const tag = buffer.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const encrypted = buffer.subarray(IV_LEN + TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(info), iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted, undefined, "utf8") + decipher.final("utf8");
}
