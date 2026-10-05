import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray, lt, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { activityLog, aiCalls, documents, rateLimits, sessions, users } from "@/server/db/schema";
import { getStorage } from "@/server/storage";

/** Politique de conservation (voir la politique de confidentialité). */
export const RETENTION = {
  activityMonths: 12,
  aiCallsMonths: 12,
  inactiveAccountMonths: 24,
  stuckMinutes: 30,
} as const;

const monthsAgo = (m: number) => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - m);
  return d;
};

export type PurgeReport = {
  expiredSessions: number;
  oldRateLimits: number;
  oldActivity: number;
  oldAiCalls: number;
  stalePendingAiCalls: number;
  stuckDocuments: number;
  orphanUserDirs: string[];
  inactiveAccounts: number;
  applied: boolean;
};

/**
 * Purge des données selon la politique de conservation. En mode simulation (par défaut),
 * rien n'est modifié : le rapport indique ce qui serait fait.
 * Les comptes inactifs sont seulement comptés : leur suppression exige une information préalable.
 */
export async function runPurge(db: Db, opts: { apply: boolean; storageDir?: string }): Promise<PurgeReport> {
  const now = new Date();
  const stuckBefore = new Date(now.getTime() - RETENTION.stuckMinutes * 60_000);
  const counts = async (table: typeof sessions | typeof rateLimits | typeof activityLog | typeof aiCalls | typeof documents | typeof users, where: ReturnType<typeof and>) =>
    Number((await db.select({ n: sql<number>`count(*)::int` }).from(table).where(where))[0]?.n ?? 0);

  const w = {
    sessions: lt(sessions.expiresAt, now),
    rate: lt(rateLimits.windowStart, new Date(now.getTime() - 2 * 86_400_000)),
    activity: lt(activityLog.createdAt, monthsAgo(RETENTION.activityMonths)),
    aiOld: lt(aiCalls.createdAt, monthsAgo(RETENTION.aiCallsMonths)),
    aiPending: and(eq(aiCalls.status, "pending"), lt(aiCalls.createdAt, stuckBefore)),
    stuck: and(eq(documents.status, "processing"), lt(documents.processingStartedAt, stuckBefore)),
    inactive: and(
      lt(users.createdAt, monthsAgo(RETENTION.inactiveAccountMonths)),
      sql`coalesce(${users.lastLoginAt}, ${users.createdAt}) < ${monthsAgo(RETENTION.inactiveAccountMonths).toISOString()}`,
    ),
  };

  const report: PurgeReport = {
    expiredSessions: await counts(sessions, w.sessions),
    oldRateLimits: await counts(rateLimits, w.rate),
    oldActivity: await counts(activityLog, w.activity),
    oldAiCalls: await counts(aiCalls, w.aiOld),
    stalePendingAiCalls: await counts(aiCalls, w.aiPending),
    stuckDocuments: await counts(documents, w.stuck),
    orphanUserDirs: [],
    inactiveAccounts: await counts(users, w.inactive),
    applied: opts.apply,
  };

  // Dossiers de fichiers sans compte associé (ex. suppression interrompue).
  if (opts.storageDir) {
    const entries = await readdir(path.resolve(opts.storageDir)).catch(() => [] as string[]);
    const ids = entries.filter((e) => /^[0-9a-f-]{36}$/.test(e));
    if (ids.length > 0) {
      const existing = new Set((await db.select({ id: users.id }).from(users).where(inArray(users.id, ids))).map((u) => u.id));
      report.orphanUserDirs = ids.filter((id) => !existing.has(id));
    }
  }

  if (opts.apply) {
    await db.delete(sessions).where(w.sessions);
    await db.delete(rateLimits).where(w.rate);
    await db.delete(activityLog).where(w.activity);
    await db.delete(aiCalls).where(w.aiOld);
    await db.update(aiCalls).set({ status: "error", errorCode: "abandoned" }).where(w.aiPending);
    await db
      .update(documents)
      .set({ status: "failed", processingStartedAt: null, errorMessage: "L'analyse a été interrompue. Vous pouvez la relancer." })
      .where(w.stuck);
    for (const id of report.orphanUserDirs) await getStorage().deleteUser(id);
  }
  return report;
}
