import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getSetting } from "@/server/settings";
import { checkPasswordPolicy, hashPassword, verifyDummy, verifyPassword } from "./password";
import { createSession } from "./session";
import { sendVerificationEmail } from "./account-flows";
import { TERMS_VERSION } from "@/lib/legal";

const emailSchema = z.string().trim().toLowerCase().max(254).email();

export const registerSchema = z.object({
  email: emailSchema,
  password: z.string().max(200),
  name: z.string().trim().min(1).max(100),
  acceptTerms: z.literal(true),
});

export const loginSchema = z.object({ email: emailSchema, password: z.string().max(200) });

export async function registerUser(db: Executor, input: unknown, ip: string | null) {
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    if (field === "acceptTerms") throw badRequest("Vous devez accepter les conditions d'utilisation.");
    if (field === "email") throw badRequest("Adresse e-mail invalide.");
    if (field === "name") throw badRequest("Veuillez indiquer votre nom.");
    throw badRequest("Informations invalides.");
  }
  const { email, password, name } = parsed.data;
  if (!(await getSetting(db, "registrations_enabled"))) {
    throw new AppError(503, "registrations_closed", "Les inscriptions sont temporairement fermées.");
  }
  await enforceRateLimit(db, `register:${ip ?? "global"}`, ip ? 10 : 200, 3600, "Trop d'inscriptions. Réessayez plus tard.");
  const policy = checkPasswordPolicy(password, email);
  if (policy) throw badRequest(policy, "weak_password");

  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) throw new AppError(409, "email_taken", "Un compte existe déjà avec cette adresse. Connectez-vous.");

  const passwordHash = await hashPassword(password);
  let user;
  try {
    [user] = await db
      .insert(users)
      .values({ email, passwordHash, name, termsAcceptedAt: new Date(), termsVersion: TERMS_VERSION })
      .returning({ id: users.id });
  } catch {
    // Course entre deux inscriptions simultanées : l'index unique tranche.
    throw new AppError(409, "email_taken", "Un compte existe déjà avec cette adresse. Connectez-vous.");
  }
  await logActivity(db, user!.id, "account.created", { details: { cgu: TERMS_VERSION } });
  await sendVerificationEmail(db, { id: user!.id, email, name });
  const session = await createSession(db, user!.id);
  return { userId: user!.id, ...session };
}

export async function loginUser(db: Executor, input: unknown, ip: string | null) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Adresse e-mail ou mot de passe incorrect.", "invalid_credentials");
  const { email, password } = parsed.data;

  // Limites par compte ET par IP : freine le bourrage d'identifiants sans bloquer tout le monde.
  await enforceRateLimit(db, `login:${email}`, 10, 900, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");
  if (ip) await enforceRateLimit(db, `login-ip:${ip}`, 50, 900, "Trop de tentatives de connexion. Réessayez dans quelques minutes.");

  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  const user = rows[0];
  if (!user) {
    await verifyDummy(password);
    throw new AppError(401, "invalid_credentials", "Adresse e-mail ou mot de passe incorrect.");
  }
  if (!(await verifyPassword(user.passwordHash, password))) {
    throw new AppError(401, "invalid_credentials", "Adresse e-mail ou mot de passe incorrect.");
  }
  // Une connexion annule tout avertissement de suppression pour inactivité.
  await db.update(users).set({ lastLoginAt: new Date(), inactivityNoticeSentAt: null }).where(eq(users.id, user.id));
  await logActivity(db, user.id, "auth.login");
  const session = await createSession(db, user.id);
  return { userId: user.id, ...session };
}
