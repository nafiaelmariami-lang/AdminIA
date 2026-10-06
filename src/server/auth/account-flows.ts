import "server-only";
import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { getConfig } from "@/server/config";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { sendEmailSafely } from "@/server/email";
import { emails } from "@/server/email/templates";
import { checkPasswordPolicy, hashPassword, verifyDummy, verifyPassword } from "./password";
import { createSession, invalidateUserSessions, type SessionUser } from "./session";
import { consumeToken, issueToken } from "./tokens";

const appUrl = () => getConfig().APP_URL.replace(/\/$/, "");

export async function sendVerificationEmail(db: Executor, user: { id: string; email: string; name: string }): Promise<boolean> {
  const token = await issueToken(db, user.id, "verify_email");
  return sendEmailSafely(emails.verifyEmail(user.email, user.name, `${appUrl()}/verifier-email?token=${encodeURIComponent(token)}`));
}

export async function resendVerificationEmail(db: Executor, user: SessionUser): Promise<void> {
  if (user.emailVerifiedAt) throw badRequest("Votre adresse e-mail est déjà confirmée.", "already_verified");
  await enforceRateLimit(db, `verify-resend:${user.id}`, 3, 3600, "Trop de demandes. Réessayez dans une heure.");
  if (!(await sendVerificationEmail(db, user))) {
    throw new AppError(503, "email_unavailable", "L'envoi d'e-mails est momentanément indisponible. Réessayez plus tard.");
  }
}

export async function verifyEmail(db: Executor, input: unknown): Promise<void> {
  const token = (input as { token?: unknown } | null)?.token;
  const userId = await consumeToken(db, token, "verify_email");
  if (!userId) throw badRequest("Ce lien de confirmation est invalide ou a expiré. Demandez-en un nouveau depuis votre espace.", "invalid_token");
  const updated = await db
    .update(users)
    .set({ emailVerifiedAt: new Date() })
    .where(and(eq(users.id, userId), isNull(users.emailVerifiedAt)))
    .returning({ id: users.id });
  if (updated.length > 0) await logActivity(db, userId, "account.email_verified");
}

const forgotSchema = z.object({ email: z.string().trim().toLowerCase().max(254).email() });

/**
 * Mot de passe oublié. La réponse est TOUJOURS identique (que le compte existe ou non)
 * pour ne pas révéler quelles adresses sont inscrites.
 */
export async function requestPasswordReset(db: Executor, input: unknown, ip: string | null): Promise<void> {
  const parsed = forgotSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Adresse e-mail invalide.");
  const { email } = parsed.data;
  await enforceRateLimit(db, `forgot:${email}`, 3, 3600, "Trop de demandes pour cette adresse. Réessayez dans une heure.");
  if (ip) await enforceRateLimit(db, `forgot-ip:${ip}`, 20, 3600, "Trop de demandes. Réessayez plus tard.");
  const [user] = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;
  const token = await issueToken(db, user.id, "reset_password");
  await sendEmailSafely(emails.resetPassword(user.email, `${appUrl()}/reinitialiser-mot-de-passe?token=${encodeURIComponent(token)}`));
  await logActivity(db, user.id, "account.password_reset_requested");
}

const resetSchema = z.object({ token: z.string().min(20).max(100), password: z.string().max(200) });

/**
 * Réinitialisation : jeton à usage unique, toutes les sessions sont fermées, une nouvelle est ouverte.
 * Avec la double authentification, aucune session n'est ouverte : l'accès à la boîte e-mail
 * ne suffit pas, il faut se reconnecter avec le second facteur.
 */
export async function resetPassword(db: Executor, input: unknown) {
  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Lien invalide.", "invalid_token");
  // La politique est vérifiée AVANT de consommer le jeton : un mot de passe refusé ne « brûle » pas le lien.
  const policy = checkPasswordPolicy(parsed.data.password);
  if (policy) throw badRequest(policy, "weak_password");
  const userId = await consumeToken(db, parsed.data.token, "reset_password");
  if (!userId) throw badRequest("Ce lien de réinitialisation est invalide, a expiré ou a déjà été utilisé. Faites une nouvelle demande.", "invalid_token");
  const [user] = await db.select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt, totpEnabledAt: users.totpEnabledAt }).from(users).where(eq(users.id, userId));
  if (!user) throw badRequest("Compte introuvable.", "invalid_token");
  const policyWithEmail = checkPasswordPolicy(parsed.data.password, user.email);
  if (policyWithEmail) throw badRequest(policyWithEmail, "weak_password");

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      passwordChangedAt: new Date(),
      // Avoir reçu le lien prouve l'accès à la boîte e-mail.
      emailVerifiedAt: user.emailVerifiedAt ?? new Date(),
    })
    .where(eq(users.id, userId));
  await invalidateUserSessions(db, userId);
  await logActivity(db, userId, "account.password_changed", { details: { via: "reinitialisation" } });
  await sendEmailSafely(emails.passwordChanged(user.email, `${appUrl()}/mot-de-passe-oublie`));
  if (user.totpEnabledAt) return { userId, loginRequired: true as const };
  return { userId, loginRequired: false as const, ...(await createSession(db, userId)) };
}

const changeSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) });

/** Changement depuis l'espace connecté : ancien mot de passe exigé ; les autres appareils sont déconnectés. */
export async function changePassword(db: Executor, user: SessionUser, currentToken: string | null, input: unknown): Promise<void> {
  const parsed = changeSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Saisissez votre mot de passe actuel et le nouveau.");
  await enforceRateLimit(db, `change-password:${user.id}`, 5, 900, "Trop de tentatives. Réessayez dans quelques minutes.");
  const [row] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id));
  if (!row || !(await verifyPassword(row.passwordHash, parsed.data.currentPassword))) {
    if (!row) await verifyDummy(parsed.data.currentPassword);
    throw new AppError(401, "invalid_password", "Mot de passe actuel incorrect.");
  }
  if (parsed.data.newPassword === parsed.data.currentPassword) throw badRequest("Le nouveau mot de passe doit être différent de l'actuel.", "same_password");
  const policy = checkPasswordPolicy(parsed.data.newPassword, user.email);
  if (policy) throw badRequest(policy, "weak_password");
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.newPassword), passwordChangedAt: new Date() }).where(eq(users.id, user.id));
  await invalidateUserSessions(db, user.id, currentToken);
  await logActivity(db, user.id, "account.password_changed", { details: { via: "espace" } });
  await sendEmailSafely(emails.passwordChanged(user.email, `${appUrl()}/mot-de-passe-oublie`));
}
