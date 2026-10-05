import "server-only";
import { asc, count, eq, sum } from "drizzle-orm";
import { Zip, ZipPassThrough } from "fflate";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { activityLog, documents, tasks, usageCounters, users } from "@/server/db/schema";
import { AppError, badRequest } from "@/server/errors";
import { getPlan } from "@/lib/plans";
import { omit } from "@/lib/omit";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getStorage } from "@/server/storage";
import { getAnalysesUsed } from "@/server/billing/usage";
import { verifyPassword } from "@/server/auth/password";
import { invalidateUserSessions } from "@/server/auth/session";
import { sanitizeFileName } from "@/server/documents/service";

export async function getAccountSummary(db: Executor, userId: string) {
  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name, plan: users.plan, createdAt: users.createdAt, planRenewsAt: users.planRenewsAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!user) throw new AppError(404, "not_found", "Compte introuvable.");
  const plan = getPlan(user.plan);
  const [stats] = await db.select({ n: count(), bytes: sum(documents.sizeBytes) }).from(documents).where(eq(documents.userId, userId));
  const used = await getAnalysesUsed(db, userId);
  return {
    user,
    plan,
    usage: {
      analysesUsed: used,
      analysesLimit: plan.analysesPerMonth,
      documents: Number(stats?.n ?? 0),
      documentsLimit: plan.maxDocuments,
      storageBytes: Number(stats?.bytes ?? 0),
    },
  };
}

/**
 * Export RGPD (droit d'accès et à la portabilité) : archive ZIP en flux contenant
 * donnees.json (toutes les données du compte) et les fichiers originaux déchiffrés.
 */
export async function exportAccount(db: Executor, userId: string): Promise<ReadableStream<Uint8Array>> {
  await enforceRateLimit(db, `export:${userId}`, 5, 3600, "Trop d'exports. Réessayez dans une heure.");
  const [user] = await db
    .select({ email: users.email, name: users.name, plan: users.plan, createdAt: users.createdAt, lastLoginAt: users.lastLoginAt })
    .from(users)
    .where(eq(users.id, userId));
  const docs = await db.select().from(documents).where(eq(documents.userId, userId)).orderBy(asc(documents.createdAt));
  const userTasks = await db.select().from(tasks).where(eq(tasks.userId, userId)).orderBy(asc(tasks.createdAt));
  const activity = await db.select().from(activityLog).where(eq(activityLog.userId, userId)).orderBy(asc(activityLog.createdAt));
  const usage = await db.select().from(usageCounters).where(eq(usageCounters.userId, userId));
  await logActivity(db, userId, "account.exported");

  const usedNames = new Set<string>();
  const fileEntries = docs.map((d, i) => {
    let name = `documents/${String(i + 1).padStart(4, "0")}-${sanitizeFileName(d.originalName)}`;
    while (usedNames.has(name)) name = name.replace(/(\.[^.]+)?$/, "_$1");
    usedNames.add(name);
    return { doc: d, name };
  });

  const data = {
    format: "adminia-export-v1",
    exportedAt: new Date().toISOString(),
    compte: user,
    documents: fileEntries.map(({ doc, name }) => ({ ...omit(doc, ["storageKey", "searchVector", "userId"]), fichier: name })),
    echeances: userTasks.map((t) => omit(t, ["userId"])),
    historique: activity.map((a) => omit(a, ["userId"])),
    consommation: usage.map((u) => omit(u, ["userId"])),
  };

  const storage = getStorage();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const zip = new Zip((err, chunk, final) => {
        if (err) {
          controller.error(err);
          return;
        }
        controller.enqueue(chunk);
        if (final) controller.close();
      });
      const add = (name: string, bytes: Uint8Array) => {
        const entry = new ZipPassThrough(name);
        zip.add(entry);
        entry.push(bytes, true);
      };
      try {
        add("donnees.json", new TextEncoder().encode(JSON.stringify(data, null, 2)));
        add(
          "LISEZ-MOI.txt",
          new TextEncoder().encode(
            "Export de vos données AdminIA.\n\n- donnees.json : compte, documents, analyses, échéances, historique.\n- documents/ : vos fichiers originaux.\n",
          ),
        );
        for (const { doc, name } of fileEntries) {
          try {
            add(name, await storage.get(doc.storageKey));
          } catch {
            add(`${name}.ERREUR.txt`, new TextEncoder().encode("Ce fichier n'a pas pu être lu."));
          }
        }
        zip.end();
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

const deleteSchema = z.object({ password: z.string().min(1).max(200), confirm: z.literal("SUPPRIMER") });

/** Suppression définitive du compte (droit à l'effacement) : données, fichiers et sessions. */
export async function deleteAccount(db: Executor, userId: string, input: unknown): Promise<void> {
  const parsed = deleteSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Saisissez votre mot de passe et le mot SUPPRIMER pour confirmer.");
  await enforceRateLimit(db, `delete-account:${userId}`, 5, 900, "Trop de tentatives. Réessayez plus tard.");
  const [user] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, userId));
  if (!user || !(await verifyPassword(user.passwordHash, parsed.data.password))) {
    throw new AppError(401, "invalid_password", "Mot de passe incorrect.");
  }
  await invalidateUserSessions(db, userId);
  // Suppression en cascade : documents, échéances, historique, compteurs. Les journaux de coûts IA sont anonymisés.
  await db.delete(users).where(eq(users.id, userId));
  try {
    await getStorage().deleteUser(userId);
  } catch (err) {
    console.error("[compte] fichiers non supprimés, à purger", userId, err instanceof Error ? err.message : err);
  }
}
