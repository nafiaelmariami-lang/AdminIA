import "server-only";
import { and, desc, eq, lt } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { activityLog } from "@/server/db/schema";

export type ActivityAction =
  | "account.created"
  | "auth.login"
  | "auth.logout"
  | "document.uploaded"
  | "document.analyzed"
  | "document.analysis_failed"
  | "document.updated"
  | "document.deleted"
  | "task.created"
  | "task.completed"
  | "task.reopened"
  | "task.deleted"
  | "account.exported"
  | "account.email_verified"
  | "account.password_reset_requested"
  | "account.password_changed"
  | "billing.plan_changed";

/** Journal d'activité utilisateur. Ne contient jamais le contenu des documents. */
export async function logActivity(
  db: Executor,
  userId: string,
  action: ActivityAction,
  opts: { documentId?: string | null; details?: Record<string, string | number | boolean | null> } = {},
): Promise<void> {
  await db.insert(activityLog).values({ userId, action, documentId: opts.documentId ?? null, details: opts.details ?? null });
}

export async function listActivity(db: Executor, userId: string, opts: { limit?: number; before?: Date } = {}) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  return db
    .select()
    .from(activityLog)
    .where(and(eq(activityLog.userId, userId), opts.before ? lt(activityLog.createdAt, opts.before) : undefined))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}
