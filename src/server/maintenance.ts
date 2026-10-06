import "server-only";
import { and, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { Db } from "@/server/db";
import { activityLog, aiCalls, authTokens, documents, mfaChallenges, rateLimits, reminderLog, sessions, stripeEvents, users } from "@/server/db/schema";
import { getStorage } from "@/server/storage";
import { getConfig } from "@/server/config";
import { log } from "@/server/logger";
import { sendEmailSafely } from "@/server/email";
import { emails } from "@/server/email/templates";
import { eraseAccount } from "@/server/account/service";
import { formatDate } from "@/lib/format";

/** Politique de conservation (voir la politique de confidentialité et docs/04-RGPD.md). */
export const RETENTION = {
  activityMonths: 12,
  aiCallsMonths: 12,
  inactiveAccountMonths: 24,
  /** Délai entre l'avertissement par e-mail et la suppression d'un compte inactif. */
  inactivityNoticeDays: 30,
  stripeEventsDays: 90,
  reminderLogDays: 400,
  stuckMinutes: 30,
} as const;

const DAY_MS = 86_400_000;

const monthsAgo = (m: number, now: Date) => {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() - m);
  return d;
};

export type PurgeReport = {
  expiredSessions: number;
  expiredAuthTokens: number;
  expiredMfaChallenges: number;
  oldRateLimits: number;
  oldActivity: number;
  oldAiCalls: number;
  oldStripeEvents: number;
  oldReminderLogs: number;
  stalePendingAiCalls: number;
  stuckDocuments: number;
  orphanUserDirs: string[];
  /** Comptes inactifs à prévenir (avertissement envoyé en mode --apply). */
  inactivityNotices: number;
  /** Comptes prévenus il y a plus de 30 jours et toujours inactifs (supprimés en mode --apply). */
  inactiveAccountsDeleted: number;
  applied: boolean;
};

/**
 * Purge des données selon la politique de conservation. En mode simulation (par défaut),
 * rien n'est modifié : le rapport indique ce qui serait fait.
 *
 * Comptes inactifs : avertissement par e-mail 30 jours avant les 24 mois d'inactivité, puis
 * suppression si la personne ne s'est pas reconnectée (une connexion annule l'avertissement).
 */
export async function runPurge(db: Db, opts: { apply: boolean; now?: Date }): Promise<PurgeReport> {
  const now = opts.now ?? new Date();
  const stuckBefore = new Date(now.getTime() - RETENTION.stuckMinutes * 60_000);
  const count = async (table: PgTable, where: SQL | undefined) =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where))[0]?.n ?? 0);

  const lastActivity = sql`coalesce(${users.lastLoginAt}, ${users.createdAt})`;
  const noticeThreshold = new Date(monthsAgo(RETENTION.inactiveAccountMonths, now).getTime() + RETENTION.inactivityNoticeDays * DAY_MS);
  const w = {
    sessions: lt(sessions.expiresAt, now),
    mfa: lt(mfaChallenges.expiresAt, now),
    tokens: or(lt(authTokens.expiresAt, now), lt(authTokens.usedAt, new Date(now.getTime() - DAY_MS))),
    rate: lt(rateLimits.windowStart, new Date(now.getTime() - 2 * DAY_MS)),
    activity: lt(activityLog.createdAt, monthsAgo(RETENTION.activityMonths, now)),
    aiOld: lt(aiCalls.createdAt, monthsAgo(RETENTION.aiCallsMonths, now)),
    stripeOld: lt(stripeEvents.processedAt, new Date(now.getTime() - RETENTION.stripeEventsDays * DAY_MS)),
    reminderOld: lt(reminderLog.sentAt, new Date(now.getTime() - RETENTION.reminderLogDays * DAY_MS)),
    aiPending: and(eq(aiCalls.status, "pending"), lt(aiCalls.createdAt, stuckBefore)),
    stuck: and(eq(documents.status, "processing"), lt(documents.processingStartedAt, stuckBefore)),
    toNotify: and(isNull(users.inactivityNoticeSentAt), sql`${lastActivity} < ${noticeThreshold.toISOString()}`),
    toDelete: and(
      isNotNull(users.inactivityNoticeSentAt),
      lt(users.inactivityNoticeSentAt, new Date(now.getTime() - RETENTION.inactivityNoticeDays * DAY_MS)),
      sql`${lastActivity} < ${users.inactivityNoticeSentAt}`,
    ),
  };

  const report: PurgeReport = {
    expiredSessions: await count(sessions, w.sessions),
    expiredAuthTokens: await count(authTokens, w.tokens),
    expiredMfaChallenges: await count(mfaChallenges, w.mfa),
    oldRateLimits: await count(rateLimits, w.rate),
    oldActivity: await count(activityLog, w.activity),
    oldAiCalls: await count(aiCalls, w.aiOld),
    oldStripeEvents: await count(stripeEvents, w.stripeOld),
    oldReminderLogs: await count(reminderLog, w.reminderOld),
    stalePendingAiCalls: await count(aiCalls, w.aiPending),
    stuckDocuments: await count(documents, w.stuck),
    orphanUserDirs: [],
    inactivityNotices: await count(users, w.toNotify),
    inactiveAccountsDeleted: 0,
    applied: opts.apply,
  };
  const toDelete = await db.select({ id: users.id }).from(users).where(w.toDelete);
  report.inactiveAccountsDeleted = toDelete.length;

  // Fichiers sans compte associé (ex. suppression interrompue), quel que soit le pilote de stockage.
  const ids = await getStorage().listUserIds();
  if (ids.length > 0) {
    const existing = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((u) => u.id));
    report.orphanUserDirs = ids.filter((id) => !existing.has(id));
  }

  if (!opts.apply) return report;

  await db.delete(sessions).where(w.sessions);
  await db.delete(authTokens).where(w.tokens);
  await db.delete(mfaChallenges).where(w.mfa);
  await db.delete(rateLimits).where(w.rate);
  await db.delete(activityLog).where(w.activity);
  await db.delete(aiCalls).where(w.aiOld);
  await db.delete(stripeEvents).where(w.stripeOld);
  await db.delete(reminderLog).where(w.reminderOld);
  await db.update(aiCalls).set({ status: "error", errorCode: "abandoned" }).where(w.aiPending);
  await db
    .update(documents)
    .set({ status: "failed", processingStartedAt: null, errorMessage: "L'analyse a été interrompue. Vous pouvez la relancer." })
    .where(w.stuck);
  for (const id of report.orphanUserDirs) await getStorage().deleteUser(id);

  // Comptes inactifs : avertissement puis suppression
  const appUrl = getConfig().APP_URL.replace(/\/$/, "");
  const notify = await db.select({ id: users.id, email: users.email, name: users.name }).from(users).where(w.toNotify);
  const deletionDate = formatDate(new Date(now.getTime() + RETENTION.inactivityNoticeDays * DAY_MS));
  for (const u of notify) {
    if (await sendEmailSafely(emails.inactivityNotice(u.email, u.name, deletionDate, `${appUrl}/connexion`))) {
      await db.update(users).set({ inactivityNoticeSentAt: now }).where(eq(users.id, u.id));
    }
  }
  for (const u of toDelete) {
    try {
      await eraseAccount(db, u.id);
      log.info("retention.account_deleted", { userId: u.id });
    } catch (err) {
      log.error("retention.account_delete_failed", { userId: u.id, error: err });
    }
  }
  return report;
}
