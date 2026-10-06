import "server-only";
import { eq } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { getDb } from "@/server/db";
import { users } from "@/server/db/schema";
import { getConfig } from "@/server/config";
import { AppError, notFound } from "@/server/errors";
import { requireUser } from "@/server/auth/guard";
import type { SessionUser } from "@/server/auth/session";

/** Liste des administrateurs : variable d'environnement uniquement (aucune élévation possible depuis l'application). */
export function adminEmails(): Set<string> {
  return new Set(
    (getConfig().ADMIN_EMAILS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export const isAdminEmail = (email: string) => adminEmails().has(email.toLowerCase());

export type AdminAccess = "admin" | "needs_verification" | "needs_mfa" | "none";

/** Un administrateur doit avoir confirmé son adresse et activé la double authentification. */
export async function adminAccess(db: Executor, user: SessionUser): Promise<AdminAccess> {
  if (!isAdminEmail(user.email)) return "none";
  if (!user.emailVerifiedAt) return "needs_verification";
  const [row] = await db.select({ totpEnabledAt: users.totpEnabledAt }).from(users).where(eq(users.id, user.id));
  return row?.totpEnabledAt ? "admin" : "needs_mfa";
}

/**
 * Routes API d'administration. Un non-administrateur reçoit 404 (l'interface n'est pas révélée) ;
 * un administrateur sans double authentification reçoit 403.
 */
export async function requireAdmin(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  const access = await adminAccess(await getDb(), user);
  if (access === "none") throw notFound("Page");
  if (access === "needs_verification") throw new AppError(403, "admin_email_unverified", "Confirmez votre adresse e-mail pour accéder à l'administration.");
  if (access === "needs_mfa") throw new AppError(403, "admin_mfa_required", "Activez la double authentification pour accéder à l'administration.");
  return user;
}
