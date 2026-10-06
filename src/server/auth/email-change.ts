import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { recoveryCodes, users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { getConfig } from "@/server/config";
import { log } from "@/server/logger";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { sendEmailSafely } from "@/server/email";
import { emails } from "@/server/email/templates";
import { verifyPassword } from "./password";
import { invalidateUserSessions, type SessionUser } from "./session";
import { consumeToken, issueToken } from "./tokens";
import { verifySecondFactor } from "./mfa";
import { syncCustomerEmail } from "@/server/billing/stripe";

/*
 * Changement d'adresse e-mail en trois temps :
 * 1. demande depuis l'espace (mot de passe + second facteur s'il est actif) → lien envoyé à la NOUVELLE adresse,
 *    simple avertissement à l'ancienne ;
 * 2. confirmation depuis la nouvelle adresse → changement effectif ;
 * 3. l'ancienne adresse reçoit un lien d'annulation valable 7 jours (rétablit l'adresse, ferme toutes
 *    les sessions, désactive la double authentification et envoie un lien de réinitialisation).
 */

const appUrl = () => getConfig().APP_URL.replace(/\/$/, "");

/** « marie@exemple.fr » → « m•••e@exemple.fr » : assez pour reconnaître, pas pour divulguer. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  const shown = local.length <= 2 ? `${local[0] ?? ""}•••` : `${local[0]}•••${local[local.length - 1]}`;
  return `${shown}@${domain}`;
}

const requestSchema = z.object({
  newEmail: z.string().trim().toLowerCase().max(254).email(),
  password: z.string().min(1).max(200),
  code: z.string().trim().max(40).optional(),
});

export const EMAIL_CHANGE_SENT = "Si cette adresse est disponible, un lien de confirmation vient d'y être envoyé. Le changement prendra effet après confirmation.";

export async function requestEmailChange(db: Executor, user: SessionUser, input: unknown): Promise<void> {
  const parsed = requestSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    throw badRequest(field === "newEmail" ? "Nouvelle adresse e-mail invalide." : "Saisissez votre mot de passe.");
  }
  const { newEmail, password, code } = parsed.data;
  await enforceRateLimit(db, `email-change:${user.id}`, 5, 3600, "Trop de demandes. Réessayez dans une heure.");
  const [row] = await db.select().from(users).where(eq(users.id, user.id));
  if (!row) throw new AppError(404, "not_found", "Compte introuvable.");
  if (!(await verifyPassword(row.passwordHash, password))) throw new AppError(401, "invalid_password", "Mot de passe incorrect.");
  if (row.totpEnabledAt) {
    if (!code) throw badRequest("Saisissez le code de votre application de double authentification.", "mfa_required");
    if (!(await verifySecondFactor(db, user.id, code))) throw badRequest("Code incorrect.", "mfa_invalid_code");
  }
  if (newEmail === row.email) throw badRequest("C'est déjà l'adresse de votre compte.", "same_email");

  await db.update(users).set({ pendingEmail: newEmail }).where(eq(users.id, user.id));
  await logActivity(db, user.id, "account.email_change_requested");
  await sendEmailSafely(emails.emailChangeRequested(row.email, maskEmail(newEmail), `${appUrl()}/mot-de-passe-oublie`));

  // Adresse déjà utilisée par un autre compte : même réponse, aucun lien (ne révèle pas qui est inscrit).
  const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, newEmail)).limit(1);
  if (taken) return;
  const token = await issueToken(db, user.id, "change_email");
  await sendEmailSafely(emails.confirmNewEmail(newEmail, row.name, `${appUrl()}/confirmer-adresse?token=${encodeURIComponent(token)}`));
}

export async function cancelEmailChange(db: Executor, user: SessionUser): Promise<void> {
  await db.update(users).set({ pendingEmail: null }).where(eq(users.id, user.id));
  await issueToken(db, user.id, "change_email"); // remplace (et donc invalide) le lien envoyé
}

export async function confirmEmailChange(db: Executor, input: unknown): Promise<{ email: string }> {
  const userId = await consumeToken(db, (input as { token?: unknown } | null)?.token, "change_email");
  if (!userId) throw badRequest("Ce lien est invalide, a expiré ou a déjà été utilisé. Refaites la demande depuis votre compte.", "invalid_token");
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row?.pendingEmail) throw badRequest("Aucun changement d'adresse en attente.", "invalid_token");
  const newEmail = row.pendingEmail;
  const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, newEmail), ne(users.id, userId))).limit(1);
  if (taken) throw new AppError(409, "email_taken", "Cette adresse est déjà utilisée par un autre compte.");
  try {
    await db
      .update(users)
      .set({ email: newEmail, pendingEmail: null, previousEmail: row.email, emailVerifiedAt: new Date() })
      .where(eq(users.id, userId));
  } catch {
    // Course avec une inscription simultanée : l'index unique tranche.
    throw new AppError(409, "email_taken", "Cette adresse est déjà utilisée par un autre compte.");
  }
  await logActivity(db, userId, "account.email_changed");
  if (row.billingCustomerId) await syncCustomerEmail(row.billingCustomerId, newEmail);
  const revert = await issueToken(db, userId, "revert_email");
  await sendEmailSafely(emails.emailChanged(row.email, maskEmail(newEmail), `${appUrl()}/annuler-changement-adresse?token=${encodeURIComponent(revert)}`));
  return { email: newEmail };
}

/** Annulation depuis l'ancienne adresse : on considère le compte compromis. */
export async function revertEmailChange(db: Executor, input: unknown): Promise<void> {
  const userId = await consumeToken(db, (input as { token?: unknown } | null)?.token, "revert_email");
  if (!userId) throw badRequest("Ce lien est invalide, a expiré ou a déjà été utilisé.", "invalid_token");
  const [row] = await db.select().from(users).where(eq(users.id, userId));
  if (!row?.previousEmail) throw badRequest("Aucun changement d'adresse à annuler.", "invalid_token");
  const restored = row.previousEmail;
  const [taken] = await db.select({ id: users.id }).from(users).where(and(eq(users.email, restored), ne(users.id, userId))).limit(1);
  if (taken) throw new AppError(409, "email_taken", "L'ancienne adresse est maintenant utilisée par un autre compte. Contactez-nous.");
  await db
    .update(users)
    .set({
      email: restored,
      previousEmail: null,
      pendingEmail: null,
      emailVerifiedAt: new Date(),
      // L'intrus a pu activer sa propre double authentification : elle est retirée.
      totpSecretEnc: null,
      totpPendingSecretEnc: null,
      totpEnabledAt: null,
      totpLastCounter: null,
    })
    .where(eq(users.id, userId));
  await db.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
  await invalidateUserSessions(db, userId);
  await logActivity(db, userId, "account.email_change_reverted");
  if (row.billingCustomerId) await syncCustomerEmail(row.billingCustomerId, restored);
  log.warn("auth.email_change_reverted", { userId });
  const reset = await issueToken(db, userId, "reset_password");
  await sendEmailSafely(emails.resetPassword(restored, `${appUrl()}/reinitialiser-mot-de-passe?token=${encodeURIComponent(reset)}`));
}
