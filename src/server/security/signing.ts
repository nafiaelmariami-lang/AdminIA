import "server-only";
import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/server/config";

/**
 * Signatures HMAC-SHA256 pour les liens sans connexion (ex. désabonnement des rappels).
 * Clé dérivée (HKDF) de la clé maîtresse, distincte par usage : une signature d'un usage
 * ne vaut jamais pour un autre.
 */
function keyFor(purpose: string): Buffer {
  return Buffer.from(hkdfSync("sha256", getConfig().storageKey, Buffer.alloc(0), `adminia-signing-v1:${purpose}`, 32));
}

export function sign(purpose: string, value: string): string {
  return createHmac("sha256", keyFor(purpose)).update(value).digest("base64url");
}

export function verifySignature(purpose: string, value: string, signature: unknown): boolean {
  if (typeof signature !== "string" || signature.length > 100) return false;
  const expected = Buffer.from(sign(purpose, value));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
