import "server-only";
import { and, asc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { documents, reminderLog, tasks } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/errors";
import { isUuid } from "@/server/http";
import { logActivity } from "@/server/activity";
import { cleanText, normalizeDate } from "@/server/ai/schema";
import { getOwnedDocument } from "@/server/documents/service";

export type TaskRow = typeof tasks.$inferSelect;
export type TaskWithDocument = TaskRow & { documentTitle: string | null };

const MAX_TASKS_PER_USER = 2000;

const dateField = z
  .string()
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const d = normalizeDate(v);
    if (!d) {
      ctx.addIssue({ code: "custom", message: "date" });
      return z.NEVER;
    }
    return d;
  });

export async function listTasks(db: Executor, userId: string, opts: { status?: "todo" | "done" | "all"; documentId?: string; limit?: number } = {}) {
  const conditions: SQL[] = [eq(tasks.userId, userId)];
  if (opts.status && opts.status !== "all") conditions.push(eq(tasks.status, opts.status));
  if (opts.documentId) {
    if (!isUuid(opts.documentId)) return [];
    conditions.push(eq(tasks.documentId, opts.documentId));
  }
  const rows = await db
    .select({ task: tasks, documentTitle: documents.title })
    .from(tasks)
    .leftJoin(documents, and(eq(documents.id, tasks.documentId), eq(documents.userId, userId)))
    .where(and(...conditions))
    // À faire : les plus urgentes d'abord ; sans date à la fin.
    .orderBy(sql`${tasks.dueDate} IS NULL`, asc(tasks.dueDate), asc(tasks.createdAt))
    .limit(Math.min(opts.limit ?? 500, 1000));
  return rows.map((r) => ({ ...r.task, documentTitle: r.documentTitle })) as TaskWithDocument[];
}

const createSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    dueDate: dateField,
    priority: z.enum(["haute", "moyenne", "basse"]).default("moyenne"),
    documentId: z.string().optional(),
  })
  .strict();

export async function createTask(db: Executor, userId: string, input: unknown): Promise<TaskRow> {
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Échéance invalide : vérifiez le titre et la date.");
  const { title, dueDate, priority, documentId } = parsed.data;
  if (documentId) await getOwnedDocument(db, userId, documentId); // le document doit appartenir à l'utilisateur
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(tasks).where(eq(tasks.userId, userId))) as [{ n: number }];
  if (n >= MAX_TASKS_PER_USER) throw new AppError(403, "task_limit", "Nombre maximal d'échéances atteint.");
  const [row] = await db
    .insert(tasks)
    .values({ userId, title: cleanText(title, 300), dueDate: dueDate ?? null, priority, documentId: documentId ?? null, source: "manual", kind: "action" })
    .returning();
  await logActivity(db, userId, "task.created", { documentId: documentId ?? null });
  return row!;
}

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(300).optional(),
    dueDate: dateField,
    priority: z.enum(["haute", "moyenne", "basse"]).optional(),
    status: z.enum(["todo", "done"]).optional(),
  })
  .strict();

async function getOwnedTask(db: Executor, userId: string, taskId: unknown): Promise<TaskRow> {
  if (!isUuid(taskId)) throw notFound("Échéance");
  const rows = await db.select().from(tasks).where(and(eq(tasks.id, taskId), eq(tasks.userId, userId))).limit(1);
  if (!rows[0]) throw notFound("Échéance");
  return rows[0];
}

export async function updateTask(db: Executor, userId: string, taskId: unknown, input: unknown): Promise<TaskRow> {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Modification invalide.");
  const task = await getOwnedTask(db, userId, taskId);
  const p = parsed.data;
  const [row] = await db
    .update(tasks)
    .set({
      title: p.title !== undefined ? cleanText(p.title, 300) : undefined,
      dueDate: p.dueDate,
      priority: p.priority,
      status: p.status,
      completedAt: p.status === "done" ? new Date() : p.status === "todo" ? null : undefined,
    })
    .where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)))
    .returning();
  // Nouvelle date : les rappels déjà envoyés pour l'ancienne date ne comptent plus.
  if (p.dueDate !== undefined && p.dueDate !== task.dueDate) await db.delete(reminderLog).where(eq(reminderLog.taskId, task.id));
  if (p.status && p.status !== task.status) {
    await logActivity(db, userId, p.status === "done" ? "task.completed" : "task.reopened", { documentId: task.documentId });
  }
  return row!;
}

export async function deleteTask(db: Executor, userId: string, taskId: unknown): Promise<void> {
  const task = await getOwnedTask(db, userId, taskId);
  await db.delete(tasks).where(and(eq(tasks.id, task.id), eq(tasks.userId, userId)));
  await logActivity(db, userId, "task.deleted", { documentId: task.documentId });
}

export { getOwnedTask };
