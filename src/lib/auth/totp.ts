import crypto from "crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateBase32Secret(bytes = 20) {
  const raw = crypto.randomBytes(bytes);
  let bits = "";
  for (const byte of raw) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, "0");
    out += BASE32[parseInt(chunk, 2)];
  }
  return out;
}

export function otpauthUrl(username: string, secret: string) {
  const label = encodeURIComponent(`Queo:${username}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=Queo`;
}

function decodeBase32(secret: string) {
  let bits = "";
  for (const char of secret.replace(/=+$/g, "")) {
    const value = BASE32.indexOf(char.toUpperCase());
    if (value >= 0) bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function verifyTOTP(secret: string, token: string, atSeconds = Math.floor(Date.now() / 1000)) {
  if (!/^\d{6}$/.test(token || "")) return false;

  const key = decodeBase32(secret);
  const currentStep = Math.floor(atSeconds / 30);
  for (let offset = -1; offset <= 1; offset++) {
    const buffer = Buffer.alloc(8);
    buffer.writeBigInt64BE(BigInt(currentStep + offset));
    const hmac = crypto.createHmac("sha1", key).update(buffer).digest();
    const dynamicOffset = hmac[hmac.length - 1] & 0x0f;
    const code =
      ((hmac[dynamicOffset] & 0x7f) << 24) |
      ((hmac[dynamicOffset + 1] & 0xff) << 16) |
      ((hmac[dynamicOffset + 2] & 0xff) << 8) |
      (hmac[dynamicOffset + 3] & 0xff);
    if ((code % 1_000_000).toString().padStart(6, "0") === token) return true;
  }
  return false;
}
