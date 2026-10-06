import "server-only";
import { and, eq, gte, inArray, isNotNull, lte, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { documents, reminderLog, tasks, users } from "@/server/db/schema";
import { queryRows } from "@/server/db/rows";
import { getConfig } from "@/server/config";
import { log } from "@/server/logger";
import { isEmailDeliveryEnabled, sendEmailSafely } from "@/server/email";
import { emails } from "@/server/email/templates";
import { sign } from "@/server/security/signing";

export type ReminderKind = "j7" | "j1" | "overdue";

/** Date du jour à Paris (AAAA-MM-JJ). */
export function parisToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris" }).format(now);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDays(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Type de rappel selon le nombre de jours restants. Les plages (et non des jours exacts)
 * rattrapent un passage manqué de la tâche planifiée ; chaque type n'est envoyé qu'une fois par tâche.
 */
export function reminderKind(daysLeft: number): ReminderKind | null {
  if (daysLeft >= 2 && daysLeft <= 7) return "j7";
  if (daysLeft >= 0 && daysLeft <= 1) return "j1";
  if (daysLeft < 0 && daysLeft >= -3) return "overdue";
  return null;
}

function whenLabel(daysLeft: number): string {
  if (daysLeft < 0) return daysLeft === -1 ? "En retard d'1 jour" : `En retard de ${-daysLeft} jours`;
  if (daysLeft === 0) return "Aujourd'hui";
  if (daysLeft === 1) return "Demain";
  return `Dans ${daysLeft} jours`;
}

export function unsubscribeUrl(userId: string): string {
  return `${getConfig().APP_URL.replace(/\/$/, "")}/desabonnement?u=${userId}&t=${sign("unsubscribe-reminders", userId)}`;
}

export type ReminderReport = { usersNotified: number; remindersSent: number; failedUsers: number; dryRun: boolean; skipped?: "email_disabled" };

/**
 * Envoie les rappels dus. Idempotent et sûr avec plusieurs instances : chaque (tâche, type) est
 * « réservé » en base avant l'envoi ; en cas d'échec d'envoi, la réservation est annulée.
 */
export async function runReminders(db: Db, opts: { now?: Date; apply: boolean }): Promise<ReminderReport> {
  // E-mails désactivés : rien n'est réservé, pour que les rappels partent une fois l'envoi activé.
  if (opts.apply && !isEmailDeliveryEnabled()) {
    log.warn("reminders.skipped_email_disabled", {});
    return { usersNotified: 0, remindersSent: 0, failedUsers: 0, dryRun: false, skipped: "email_disabled" };
  }
  const today = parisToday(opts.now);
  const rows = await db
    .select({
      taskId: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      userId: users.id,
      email: users.email,
      name: users.name,
      documentTitle: documents.title,
    })
    .from(tasks)
    .innerJoin(users, eq(users.id, tasks.userId))
    .leftJoin(documents, eq(documents.id, tasks.documentId))
    .where(
      and(
        eq(tasks.status, "todo"),
        isNotNull(tasks.dueDate),
        gte(tasks.dueDate, addDays(today, -3)),
        lte(tasks.dueDate, addDays(today, 7)),
        eq(users.reminderEmails, true),
        isNotNull(users.emailVerifiedAt),
      ),
    );

  const byUser = new Map<string, { email: string; name: string; items: { taskId: string; kind: ReminderKind; title: string; daysLeft: number }[] }>();
  for (const r of rows) {
    const daysLeft = diffDays(today, r.dueDate!);
    const kind = reminderKind(daysLeft);
    if (!kind) continue;
    const entry = byUser.get(r.userId) ?? { email: r.email, name: r.name, items: [] };
    entry.items.push({ taskId: r.taskId, kind, title: r.documentTitle ? `${r.title} (${r.documentTitle})` : r.title, daysLeft });
    byUser.set(r.userId, entry);
  }

  const report: ReminderReport = { usersNotified: 0, remindersSent: 0, failedUsers: 0, dryRun: !opts.apply };
  for (const [userId, u] of byUser) {
    if (!opts.apply) {
      const sent = await db.select({ taskId: reminderLog.taskId, kind: reminderLog.kind }).from(reminderLog).where(inArray(reminderLog.taskId, u.items.map((i) => i.taskId)));
      const pending = u.items.filter((i) => !sent.some((s) => s.taskId === i.taskId && s.kind === i.kind));
      if (pending.length) {
        report.usersNotified++;
        report.remindersSent += pending.length;
      }
      continue;
    }
    // Réservation atomique : seules les lignes réellement insérées seront envoyées.
    const values = sql.join(u.items.map((i) => sql`(${i.taskId}::uuid, ${i.kind})`), sql`, `);
    const claimed = await queryRows<{ task_id: string; kind: ReminderKind }>(
      db,
      sql`INSERT INTO reminder_log (task_id, kind) VALUES ${values} ON CONFLICT DO NOTHING RETURNING task_id, kind`,
    );
    const items = u.items.filter((i) => claimed.some((c) => c.task_id === i.taskId && c.kind === i.kind)).sort((a, b) => a.daysLeft - b.daysLeft);
    if (items.length === 0) continue;
    const ok = await sendEmailSafely(
      emails.reminderDigest(
        u.email,
        u.name,
        items.map((i) => ({ title: i.title, when: whenLabel(i.daysLeft) })),
        getConfig().APP_URL.replace(/\/$/, ""),
        unsubscribeUrl(userId),
      ),
    );
    if (ok) {
      report.usersNotified++;
      report.remindersSent += items.length;
    } else {
      report.failedUsers++;
      for (const i of items) await db.delete(reminderLog).where(and(eq(reminderLog.taskId, i.taskId), eq(reminderLog.kind, i.kind)));
    }
  }
  log.info("reminders.run", { ...report, today });
  return report;
}
