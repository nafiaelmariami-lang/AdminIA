import "server-only";
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/server/config";
import { decrypt, encrypt } from "@/server/storage";

/**
 * Double authentification par application (TOTP, RFC 6238) : codes à 6 chiffres renouvelés
 * toutes les 30 s (Google Authenticator, Microsoft Authenticator, 1Password, Aegis…).
 */
export const TOTP_PERIOD = 30;
export const TOTP_DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("base32 invalide");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HOTP (RFC 4226). */
export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS, algo: "sha1" | "sha256" | "sha512" = "sha1"): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac(algo, secret).update(msg).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const bin = ((h[offset]! & 0x7f) << 24) | (h[offset + 1]! << 16) | (h[offset + 2]! << 8) | h[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const counterAt = (timeMs: number) => Math.floor(timeMs / 1000 / TOTP_PERIOD);

/**
 * Vérifie un code TOTP en tolérant ±1 période (décalage d'horloge du téléphone).
 * Refuse tout compteur déjà utilisé (`lastCounter`) : un code intercepté ne peut pas resservir.
 * Renvoie le compteur accepté, ou null.
 */
export function verifyTotp(secret: Buffer, code: string, opts: { now?: number; lastCounter?: number | null } = {}): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = counterAt(opts.now ?? Date.now());
  for (const c of [current - 1, current, current + 1]) {
    if (opts.lastCounter !== undefined && opts.lastCounter !== null && c <= opts.lastCounter) continue;
    const expected = Buffer.from(hotp(secret, c));
    if (timingSafeEqual(expected, Buffer.from(code))) return c;
  }
  return null;
}

export function newTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits, recommandé par la RFC 4226
}

export function otpauthUri(secret: Buffer, email: string): string {
  const label = encodeURIComponent(`AdminIA:${email}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=AdminIA&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD}`;
}

// Le secret est chiffré en base avec une clé dérivée, liée à l'utilisateur (données authentifiées).
function totpKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", getConfig().storageKey, Buffer.alloc(0), "adminia-totp-v1", 32));
}
const aad = (userId: string) => `totp:${userId}`;

export function sealSecret(userId: string, secret: Buffer): string {
  return encrypt(totpKey(), aad(userId), secret).toString("base64");
}

export function openSecret(userId: string, sealed: string): Buffer {
  return decrypt(totpKey(), aad(userId), Buffer.from(sealed, "base64"));
}

/** Codes de secours : 10 codes « XXXXX-XXXXX » à usage unique (alphabet sans caractères ambigus). */
const RC_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const bytes = randomBytes(10);
    const chars = [...bytes].map((b) => RC_ALPHABET[b % RC_ALPHABET.length]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
