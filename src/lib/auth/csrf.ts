import crypto from "crypto";
import { now } from "@/lib/time";

const MAX_AGE_MS = 8 * 60 * 60 * 1000;

function secret() {
  const value = process.env.DIDI_APP_SECRET;
  if (!value || value.length < 32) throw new Error("DIDI_APP_SECRET must be at least 32 characters");
  return value;
}

export function issueCsrf(sessionTokenHash: string) {
  const timestamp = now();
  const payload = `${sessionTokenHash}.${timestamp}`;
  const signature = crypto.createHmac("sha256", secret()).update(payload).digest("hex");
  return `${timestamp}.${signature}`;
}

export function verifyCsrf(token: string | null | undefined, sessionTokenHash: string | null | undefined) {
  if (!token || !sessionTokenHash) return false;
  const [timestampRaw, signature] = token.split(".");
  if (!timestampRaw || !signature) return false;
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp) || now() - timestamp > MAX_AGE_MS) return false;

  const expected = crypto
    .createHmac("sha256", secret())
    .update(`${sessionTokenHash}.${timestamp}`)
    .digest("hex");
  return signature.length === expected.length && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
