import crypto from "crypto";

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export function hashPasswordSync(password: string): string {
  const salt = crypto.randomBytes(16).toString("base64");
  const derived = crypto.scryptSync(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derived.toString("base64")}`;
}

export function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16).toString("base64");
    crypto.scrypt(
      password,
      salt,
      KEY_LEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (err, derivedKey) => {
        if (err) return reject(err);
        resolve(`scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt}$${derivedKey.toString("base64")}`);
      },
    );
  });
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [algo, nStr, rStr, pStr, salt, keyBase64] = hash.split("$");
    if (algo !== "scrypt" || !salt || !keyBase64) return resolve(false);

    const originalKey = Buffer.from(keyBase64, "base64");
    crypto.scrypt(
      password,
      salt,
      originalKey.length,
      { N: Number(nStr), r: Number(rStr), p: Number(pStr) },
      (err, derivedKey) => {
        if (err) return reject(err);
        if (originalKey.length !== derivedKey.length) return resolve(false);
        resolve(crypto.timingSafeEqual(originalKey, derivedKey));
      },
    );
  });
}

export function validatePasswordPolicy(password: string) {
  return typeof password === "string" && password.length >= 12;
}
