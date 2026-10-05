import "server-only";
import { sql } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { queryRows } from "@/server/db/rows";
import { AppError } from "@/server/errors";

/**
 * Limitation de fréquence à fenêtre fixe, stockée en base (fonctionne avec plusieurs instances).
 * L'incrément est atomique (INSERT … ON CONFLICT … RETURNING).
 */
export async function hitRateLimit(db: Executor, key: string, max: number, windowSec: number): Promise<{ ok: boolean; retryAfterSec: number }> {
  const nowMs = Date.now();
  const windowStartMs = Math.floor(nowMs / (windowSec * 1000)) * windowSec * 1000;
  const windowStart = new Date(windowStartMs).toISOString();
  const rows = await queryRows<{ count: number }>(db, sql`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`);
  const count = Number(rows[0]?.count ?? 0);
  return { ok: count <= max, retryAfterSec: Math.ceil((windowStartMs + windowSec * 1000 - nowMs) / 1000) };
}

export async function enforceRateLimit(db: Executor, key: string, max: number, windowSec: number, message: string): Promise<void> {
  const r = await hitRateLimit(db, key, max, windowSec);
  if (!r.ok) throw new AppError(429, "rate_limited", message, r.retryAfterSec);
}
