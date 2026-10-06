import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, gt, sql } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { authTokens } from "@/server/db/schema";

export type TokenPurpose = "verify_email" | "reset_password" | "change_email" | "revert_email";

export const TOKEN_TTL_MS: Record<TokenPurpose, number> = {
  verify_email: 48 * 3600_000,
  reset_password: 3600_000,
  change_email: 24 * 3600_000,
  revert_email: 7 * 24 * 3600_000,
};

const hash = (raw: string) => createHash("sha256").update(raw).digest("hex");

/** Crée un jeton à usage unique ; les jetons précédents du même usage sont invalidés. */
export async function issueToken(db: Executor, userId: string, purpose: TokenPurpose): Promise<string> {
  const raw = randomBytes(32).toString("base64url");
  await db.delete(authTokens).where(and(eq(authTokens.userId, userId), eq(authTokens.purpose, purpose)));
  await db.insert(authTokens).values({ id: hash(raw), userId, purpose, expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) });
  return raw;
}

/**
 * Consomme un jeton de façon ATOMIQUE : valide, non expiré, non utilisé, du bon usage.
 * Deux requêtes simultanées ne peuvent pas utiliser le même jeton.
 */
export async function consumeToken(db: Executor, raw: unknown, purpose: TokenPurpose): Promise<string | null> {
  if (typeof raw !== "string" || raw.length < 20 || raw.length > 100) return null;
  const rows = await db
    .update(authTokens)
    .set({ usedAt: sql`now()` })
    .where(and(eq(authTokens.id, hash(raw)), eq(authTokens.purpose, purpose), isNull(authTokens.usedAt), gt(authTokens.expiresAt, new Date())))
    .returning({ userId: authTokens.userId });
  return rows[0]?.userId ?? null;
}
