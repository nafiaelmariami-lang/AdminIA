import "server-only";
import { hash, verify } from "@node-rs/argon2";

// Argon2id, paramètres recommandés par l'OWASP (m=19 Mio, t=2, p=1).
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

const COMMON = new Set([
  "motdepasse", "motdepasse1", "motdepasse123", "azertyuiop", "azerty1234", "1234567890", "0123456789",
  "password123", "password1234", "qwertyuiop", "soleil1234", "bonjour1234", "adminadmin", "administrateur",
]);

/** Retourne un message d'erreur, ou null si le mot de passe est acceptable. */
export function checkPasswordPolicy(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Le mot de passe doit contenir au moins ${PASSWORD_MIN} caractères.`;
  if (password.length > PASSWORD_MAX) return `Le mot de passe ne doit pas dépasser ${PASSWORD_MAX} caractères.`;
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(password)) return "Ce mot de passe est trop courant. Choisissez-en un autre.";
  if (email && lower.includes(email.split("@")[0]!.toLowerCase()) && email.split("@")[0]!.length >= 4) {
    return "Le mot de passe ne doit pas contenir votre adresse e-mail.";
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hachage factice : la vérification prend le même temps, que le compte existe ou non.
let dummyHash: Promise<string> | null = null;
export async function verifyDummy(password: string): Promise<void> {
  dummyHash ??= hash("adminia-dummy-password", OPTIONS);
  await verifyPassword(await dummyHash, password);
}
