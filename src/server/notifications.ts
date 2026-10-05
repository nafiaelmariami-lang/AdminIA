import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { users } from "@/server/db/schema";
import { badRequest, notFound } from "@/server/errors";
import { isUuid } from "@/server/http";
import { getConfig } from "@/server/config";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { verifySignature } from "@/server/security/signing";
import { listTasks } from "@/server/tasks/service";
import { buildIcs } from "@/server/tasks/ics";

const prefsSchema = z.object({ reminderEmails: z.boolean() }).strict();

export async function updateNotificationPrefs(db: Executor, userId: string, input: unknown): Promise<{ reminderEmails: boolean }> {
  const parsed = prefsSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Préférence invalide.");
  await db.update(users).set({ reminderEmails: parsed.data.reminderEmails }).where(eq(users.id, userId));
  return parsed.data;
}

/** Désabonnement sans connexion, via le lien signé présent dans chaque e-mail de rappel. */
export async function unsubscribeReminders(db: Executor, input: unknown): Promise<void> {
  const { u, t } = (input ?? {}) as { u?: unknown; t?: unknown };
  if (!isUuid(u) || !verifySignature("unsubscribe-reminders", u, t)) throw badRequest("Lien de désabonnement invalide.", "invalid_link");
  await db.update(users).set({ reminderEmails: false }).where(eq(users.id, u));
}

// ─────────────────────────────────────────────────────────────
// Abonnement agenda privé (Google Agenda, Outlook, Apple) : flux .ics par jeton secret
// ─────────────────────────────────────────────────────────────

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

/** Crée (ou remplace) le lien d'abonnement. Le jeton n'est montré qu'une fois ; seul son haché est stocké. */
export async function createCalendarFeed(db: Executor, userId: string): Promise<string> {
  await enforceRateLimit(db, `calendar-token:${userId}`, 10, 3600, "Trop de demandes. Réessayez plus tard.");
  const token = randomBytes(32).toString("base64url");
  await db.update(users).set({ calendarTokenHash: hashToken(token) }).where(eq(users.id, userId));
  return `${getConfig().APP_URL.replace(/\/$/, "")}/api/calendar/feed?token=${token}`;
}

export async function revokeCalendarFeed(db: Executor, userId: string): Promise<void> {
  await db.update(users).set({ calendarTokenHash: null }).where(eq(users.id, userId));
}

export async function calendarFeedFor(db: Executor, token: unknown): Promise<string> {
  if (typeof token !== "string" || token.length < 30 || token.length > 100) throw notFound("Agenda");
  const hash = hashToken(token);
  await enforceRateLimit(db, `calendar-feed:${hash.slice(0, 16)}`, 120, 3600, "Trop de requêtes.");
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.calendarTokenHash, hash)).limit(1);
  if (!user) throw notFound("Agenda");
  return buildIcs(await listTasks(db, user.id, { status: "todo" }));
}
