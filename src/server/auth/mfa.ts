import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, lt, or, sql } from "drizzle-orm";
import QRCode from "qrcode";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { mfaChallenges, recoveryCodes, users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { sendEmailSafely } from "@/server/email";
import { emails } from "@/server/email/templates";
import { verifyPassword } from "./password";
import { createSession, invalidateUserSessions, type SessionUser } from "./session";
import { newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, openSecret, otpauthUri, sealSecret, base32Encode, verifyTotp } from "./totp";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const CHALLENGE_TTL_MS = 5 * 60_000;
const MAX_CHALLENGE_ATTEMPTS = 5;

async function loadUser(db: Executor, userId: string) {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u) throw new AppError(404, "not_found", "Compte introuvable.");
  return u;
}

async function storeRecoveryCodes(db: Executor, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await db.insert(recoveryCodes).values(codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })));
  return codes;
}

/**
 * Vérifie un second facteur : code de l'application (6 chiffres, anti-rejeu atomique)
 * ou code de secours (usage unique, consommé atomiquement).
 */
export async function verifySecondFactor(db: Executor, userId: string, rawCode: unknown): Promise<"totp" | "recovery" | null> {
  if (typeof rawCode !== "string" || rawCode.length > 40) return null;
  const code = rawCode.replace(/\s/g, "");
  const u = await loadUser(db, userId);
  if (!u.totpSecretEnc || !u.totpEnabledAt) return null;

  if (/^\d{6}$/.test(code)) {
    const counter = verifyTotp(openSecret(userId, u.totpSecretEnc), code, { lastCounter: u.totpLastCounter });
    if (counter === null) return null;
    // Mise à jour conditionnelle : deux requêtes simultanées avec le même code ne passent pas toutes les deux.
    const ok = await db
      .update(users)
      .set({ totpLastCounter: counter })
      .where(and(eq(users.id, userId), or(isNull(users.totpLastCounter), lt(users.totpLastCounter, counter))))
      .returning({ id: users.id });
    return ok.length ? "totp" : null;
  }
  const normalized = normalizeRecoveryCode(code);
  if (normalized.length !== 10) return null;
  const used = await db
    .update(recoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(recoveryCodes.userId, userId), eq(recoveryCodes.codeHash, sha256(normalized)), isNull(recoveryCodes.usedAt)))
    .returning({ id: recoveryCodes.id });
  if (used.length) {
    await logActivity(db, userId, "auth.recovery_code_used");
    return "recovery";
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Activation / désactivation depuis l'espace connecté
// ─────────────────────────────────────────────────────────────

export async function startTotpSetup(db: Executor, user: SessionUser): Promise<{ secret: string; uri: string; qrSvg: string }> {
  const u = await loadUser(db, user.id);
  if (u.totpEnabledAt) throw badRequest("La double authentification est déjà activée.", "mfa_already_enabled");
  await enforceRateLimit(db, `mfa-setup:${user.id}`, 10, 3600, "Trop de tentatives. Réessayez plus tard.");
  const secret = newTotpSecret();
  await db.update(users).set({ totpPendingSecretEnc: sealSecret(user.id, secret) }).where(eq(users.id, user.id));
  const uri = otpauthUri(secret, user.email);
  const qrSvg = await QRCode.toString(uri, { type: "svg", errorCorrectionLevel: "M", margin: 1 });
  return { secret: base32Encode(secret), uri, qrSvg };
}

const codeSchema = z.object({ code: z.string().trim().min(6).max(20) });

/** Active le second facteur ; les AUTRES sessions sont fermées (un éventuel intrus est déconnecté). */
export async function enableTotp(db: Executor, user: SessionUser, currentToken: string | null, input: unknown): Promise<{ recoveryCodes: string[] }> {
  const parsed = codeSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Saisissez le code à 6 chiffres affiché par l'application.");
  await enforceRateLimit(db, `mfa-enable:${user.id}`, 10, 900, "Trop de tentatives. Réessayez dans quelques minutes.");
  const u = await loadUser(db, user.id);
  if (u.totpEnabledAt) throw badRequest("La double authentification est déjà activée.", "mfa_already_enabled");
  if (!u.totpPendingSecretEnc) throw badRequest("Commencez par afficher le QR code.", "mfa_no_setup");
  const secret = openSecret(user.id, u.totpPendingSecretEnc);
  const counter = verifyTotp(secret, parsed.data.code.replace(/\s/g, ""));
  if (counter === null) throw badRequest("Code incorrect. Vérifiez l'heure de votre téléphone et réessayez.", "mfa_invalid_code");
  await db
    .update(users)
    .set({ totpSecretEnc: u.totpPendingSecretEnc, totpPendingSecretEnc: null, totpEnabledAt: new Date(), totpLastCounter: counter })
    .where(eq(users.id, user.id));
  const codes = await storeRecoveryCodes(db, user.id);
  await invalidateUserSessions(db, user.id, currentToken);
  await logActivity(db, user.id, "account.mfa_enabled");
  await sendEmailSafely(emails.mfaChanged(user.email, true));
  return { recoveryCodes: codes };
}

const disableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(40) });

async function requirePasswordAndFactor(db: Executor, user: SessionUser, input: unknown) {
  const parsed = disableSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Saisissez votre mot de passe et un code (application ou code de secours).");
  await enforceRateLimit(db, `mfa-manage:${user.id}`, 10, 900, "Trop de tentatives. Réessayez dans quelques minutes.");
  const u = await loadUser(db, user.id);
  if (!u.totpEnabledAt) throw badRequest("La double authentification n'est pas activée.", "mfa_not_enabled");
  if (!(await verifyPassword(u.passwordHash, parsed.data.password))) throw new AppError(401, "invalid_password", "Mot de passe incorrect.");
  if (!(await verifySecondFactor(db, user.id, parsed.data.code))) throw badRequest("Code incorrect.", "mfa_invalid_code");
}

export async function disableTotp(db: Executor, user: SessionUser, input: unknown): Promise<void> {
  await requirePasswordAndFactor(db, user, input);
  await db
    .update(users)
    .set({ totpSecretEnc: null, totpPendingSecretEnc: null, totpEnabledAt: null, totpLastCounter: null })
    .where(eq(users.id, user.id));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, user.id));
  await logActivity(db, user.id, "account.mfa_disabled");
  await sendEmailSafely(emails.mfaChanged(user.email, false));
}

export async function regenerateRecoveryCodes(db: Executor, user: SessionUser, input: unknown): Promise<{ recoveryCodes: string[] }> {
  await requirePasswordAndFactor(db, user, input);
  const codes = await storeRecoveryCodes(db, user.id);
  await logActivity(db, user.id, "account.recovery_codes_regenerated");
  return { recoveryCodes: codes };
}

export async function mfaStatus(db: Executor, userId: string) {
  const u = await loadUser(db, userId);
  const [{ n }] = (await db
    .select({ n: sql<number>`count(*)::int` })
    .from(recoveryCodes)
    .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)))) as [{ n: number }];
  return { enabled: !!u.totpEnabledAt, enabledAt: u.totpEnabledAt, recoveryCodesLeft: Number(n) };
}

// ─────────────────────────────────────────────────────────────
// Connexion en deux étapes
// ─────────────────────────────────────────────────────────────

/** Après un mot de passe correct : crée une étape intermédiaire (jeton de 5 minutes, sans session). */
export async function createMfaChallenge(db: Executor, userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(mfaChallenges).values({ id: sha256(token), userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) });
  return token;
}

const completeSchema = z.object({ challenge: z.string().min(20).max(100), code: z.string().trim().min(6).max(40) });

export async function completeMfaLogin(db: Executor, input: unknown) {
  const parsed = completeSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Saisissez le code de votre application.", "mfa_invalid_code");
  // Tentative comptée AVANT vérification, de façon atomique : 5 essais au plus par étape de connexion.
  const [challenge] = await db
    .update(mfaChallenges)
    .set({ attempts: sql`${mfaChallenges.attempts} + 1` })
    .where(and(eq(mfaChallenges.id, sha256(parsed.data.challenge)), gt(mfaChallenges.expiresAt, new Date()), lt(mfaChallenges.attempts, MAX_CHALLENGE_ATTEMPTS)))
    .returning({ userId: mfaChallenges.userId });
  if (!challenge) throw new AppError(401, "mfa_expired", "Session de connexion expirée. Saisissez à nouveau votre mot de passe.");
  await enforceRateLimit(db, `mfa-login:${challenge.userId}`, 15, 900, "Trop de tentatives. Réessayez dans quelques minutes.");
  const factor = await verifySecondFactor(db, challenge.userId, parsed.data.code);
  if (!factor) throw new AppError(401, "mfa_invalid_code", "Code incorrect.");
  await db.delete(mfaChallenges).where(eq(mfaChallenges.id, sha256(parsed.data.challenge)));
  await db.update(users).set({ lastLoginAt: new Date(), inactivityNoticeSentAt: null }).where(eq(users.id, challenge.userId));
  await logActivity(db, challenge.userId, "auth.login", { details: { double_authentification: factor === "totp" ? "application" : "code de secours" } });
  return { userId: challenge.userId, ...(await createSession(db, challenge.userId)) };
}
