import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { queryRows } from "@/server/db/rows";
import { usageCounters } from "@/server/db/schema";

export function currentPeriod(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/**
 * Réserve une analyse dans le quota mensuel, de façon ATOMIQUE :
 * l'incrément n'a lieu que si le compteur est sous la limite, même avec des requêtes concurrentes.
 */
export async function reserveAnalysis(db: Executor, userId: string, limit: number): Promise<boolean> {
  if (limit <= 0) return false;
  const period = currentPeriod();
  const rows = await queryRows<{ analyses_used: number }>(db, sql`
    INSERT INTO usage_counters (user_id, period, analyses_used) VALUES (${userId}, ${period}, 1)
    ON CONFLICT (user_id, period) DO UPDATE SET analyses_used = usage_counters.analyses_used + 1
    WHERE usage_counters.analyses_used < ${limit}
    RETURNING analyses_used`);
  return rows.length > 0;
}

/** Rend une analyse réservée (échec côté service, pas de la faute de l'utilisateur). */
export async function refundAnalysis(db: Executor, userId: string, period = currentPeriod()): Promise<void> {
  await db
    .update(usageCounters)
    .set({ analysesUsed: sql`GREATEST(${usageCounters.analysesUsed} - 1, 0)` })
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, period)));
}

export async function getAnalysesUsed(db: Executor, userId: string): Promise<number> {
  const rows = await db
    .select({ used: usageCounters.analysesUsed })
    .from(usageCounters)
    .where(and(eq(usageCounters.userId, userId), eq(usageCounters.period, currentPeriod())));
  return rows[0]?.used ?? 0;
}
