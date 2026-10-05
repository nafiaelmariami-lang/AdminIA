import "server-only";
import { and, desc, eq, or } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { documents } from "@/server/db/schema";
import { getPlan } from "@/lib/plans";
import { getAnalysesUsed } from "@/server/billing/usage";
import { listDocuments } from "@/server/documents/service";
import { listTasks } from "@/server/tasks/service";
import type { SessionUser } from "@/server/auth/session";

export async function getDashboard(db: Executor, user: SessionUser) {
  const plan = getPlan(user.plan);
  const [todo, recent, attention, used] = await Promise.all([
    listTasks(db, user.id, { status: "todo", limit: 200 }),
    listDocuments(db, user.id, { limit: 5 }),
    db
      .select({ id: documents.id, title: documents.title, originalName: documents.originalName, status: documents.status, suspicious: documents.suspicious, errorMessage: documents.errorMessage })
      .from(documents)
      .where(and(eq(documents.userId, user.id), or(eq(documents.suspicious, true), eq(documents.status, "failed"), eq(documents.status, "uploaded"))))
      .orderBy(desc(documents.createdAt))
      .limit(5),
    getAnalysesUsed(db, user.id),
  ]);
  return { plan, todo, recent, attention, analysesUsed: used };
}
