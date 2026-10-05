import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/server/db";
import { queryRows } from "@/server/db/rows";
import { aiCalls, documents, tasks } from "@/server/db/schema";
import { AppError } from "@/server/errors";
import { getConfig } from "@/server/config";
import { getPlan } from "@/lib/plans";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getSetting } from "@/server/settings";
import { getStorage } from "@/server/storage";
import { reserveAnalysis, refundAnalysis, currentPeriod } from "@/server/billing/usage";
import { getOwnedDocument, refreshSearchVector, type DocumentRow } from "@/server/documents/service";
import type { SessionUser } from "@/server/auth/session";
import { getAiProvider } from "./provider";
import { costUsd, estimateInputTokens, estimateMaxCostUsd } from "./cost";
import { detectInjection } from "./injection";
import { normalizeAnalysis, type DocumentAnalysis } from "./schema";
import { AiError, type AttachmentMediaType } from "./types";

/** Une analyse « processing » plus ancienne est considérée comme abandonnée (crash, redémarrage). */
export const STALE_PROCESSING_MS = 5 * 60_000;
/** Nombre maximal d'analyses d'un même document (protection contre les boucles). */
export const MAX_ATTEMPTS_PER_DOCUMENT = 5;

const USER_MESSAGES: Record<AiError["code"], string> = {
  refusal: "L'analyse automatique n'a pas pu être réalisée pour ce document.",
  truncated: "Le document est trop complexe pour être analysé en une fois. Essayez d'envoyer uniquement les pages utiles.",
  invalid_output: "L'analyse a échoué. Vous pouvez réessayer.",
  timeout: "Le service d'analyse a mis trop de temps à répondre. Réessayez dans quelques minutes.",
  rate_limited: "Le service d'analyse est très sollicité. Réessayez dans quelques minutes.",
  provider_error: "Le service d'analyse est momentanément indisponible. Réessayez plus tard.",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Dépense IA du jour (UTC) : coût réel des appels terminés + estimation des appels en cours. */
async function spentTodayUsd(db: Db, userId?: string): Promise<number> {
  const rows = await queryRows<{ total: string | null }>(db, sql`
    SELECT COALESCE(SUM(CASE WHEN status = 'pending' THEN estimated_cost_usd ELSE cost_usd END), 0) AS total
    FROM ai_calls
    WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
    ${userId ? sql`AND user_id = ${userId}` : sql``}`);
  return Number(rows[0]?.total ?? 0);
}

export function estimateDocumentCost(doc: Pick<DocumentRow, "contentMode" | "mimeType" | "pageCount" | "extractedText">, model: string) {
  const inputTokens = estimateInputTokens({
    textChars: doc.extractedText?.length ?? 0,
    mode: doc.contentMode,
    kind: doc.mimeType === "application/pdf" ? "pdf" : doc.mimeType.startsWith("image/") ? "image" : "other",
    pages: doc.pageCount ?? 1,
  });
  return { inputTokens, maxCostUsd: estimateMaxCostUsd(model, inputTokens) };
}

/**
 * Analyse un document. Toutes les protections de coût sont appliquées ICI, côté serveur :
 * interrupteurs, fréquence, verrou anti-concurrence, plafond par document, budgets quotidiens,
 * quota mensuel atomique, tentatives bornées, journalisation.
 */
export async function analyzeDocument(db: Db, user: SessionUser, documentId: unknown): Promise<DocumentRow> {
  const cfg = getConfig();
  const plan = getPlan(user.plan);
  const provider = getAiProvider();

  // 1. Interrupteurs (variable d'environnement + réglage en base)
  if (!cfg.AI_ENABLED || !(await getSetting(db, "ai_analysis_enabled"))) {
    throw new AppError(503, "ai_disabled", "L'analyse automatique est temporairement indisponible. Vos documents restent accessibles.");
  }

  // 2. Propriété + état du document
  const doc = await getOwnedDocument(db, user.id, documentId);
  const isStale = doc.status === "processing" && (!doc.processingStartedAt || Date.now() - doc.processingStartedAt.getTime() > STALE_PROCESSING_MS);
  if (doc.status === "processing" && !isStale) throw new AppError(409, "already_processing", "L'analyse de ce document est déjà en cours.");
  if (doc.analysisAttempts >= MAX_ATTEMPTS_PER_DOCUMENT) {
    throw new AppError(429, "too_many_attempts", "Ce document a déjà été analysé plusieurs fois. Contactez le support si le problème persiste.");
  }

  // 3. Fréquence
  await enforceRateLimit(db, `analyze:${user.id}`, plan.analysesPerHour, 3600, "Trop d'analyses en peu de temps. Réessayez dans une heure.");

  // 4. Estimation du coût et budgets
  const estimate = estimateDocumentCost(doc, provider.model);
  if (estimate.maxCostUsd > cfg.AI_MAX_COST_PER_DOC_USD) {
    throw new AppError(413, "too_expensive", "Ce document est trop volumineux pour être analysé. Envoyez uniquement les pages utiles.");
  }
  if ((await spentTodayUsd(db, user.id)) + estimate.maxCostUsd > cfg.AI_USER_DAILY_BUDGET_USD) {
    throw new AppError(429, "user_daily_budget", "Limite quotidienne d'analyses atteinte. Réessayez demain.");
  }
  if ((await spentTodayUsd(db)) + estimate.maxCostUsd > cfg.AI_DAILY_BUDGET_USD) {
    console.warn("[ia] budget quotidien global atteint : analyses suspendues");
    throw new AppError(503, "global_budget", "Le service d'analyse est très sollicité aujourd'hui. Réessayez demain, vos documents sont bien enregistrés.");
  }

  // 5. Verrou + quota, dans une transaction : une seule analyse à la fois par utilisateur.
  const period = currentPeriod();
  const locked = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`analyze:${user.id}`}))`);
    const busy = await queryRows(tx, sql`
      SELECT 1 FROM documents
      WHERE user_id = ${user.id} AND status = 'processing' AND id <> ${doc.id}
        AND processing_started_at > now() - (${STALE_PROCESSING_MS} * interval '1 millisecond')
      LIMIT 1`);
    if (busy.length > 0) throw new AppError(409, "busy", "Une autre analyse est en cours. Patientez quelques secondes.");

    const claimed = await tx
      .update(documents)
      .set({ status: "processing", processingStartedAt: new Date(), analysisAttempts: sql`${documents.analysisAttempts} + 1`, errorMessage: null })
      .where(
        and(
          eq(documents.id, doc.id),
          eq(documents.userId, user.id),
          sql`${documents.analysisAttempts} < ${MAX_ATTEMPTS_PER_DOCUMENT}`,
          sql`(${documents.status} <> 'processing' OR ${documents.processingStartedAt} IS NULL OR ${documents.processingStartedAt} < now() - (${STALE_PROCESSING_MS} * interval '1 millisecond'))`,
        ),
      )
      .returning({ id: documents.id });
    if (claimed.length === 0) throw new AppError(409, "already_processing", "L'analyse de ce document est déjà en cours.");

    if (!(await reserveAnalysis(tx, user.id, plan.analysesPerMonth))) {
      throw new AppError(
        402,
        "quota_exceeded",
        `Vous avez utilisé vos ${plan.analysesPerMonth} analyses du mois (formule ${plan.label}). Passez à une formule supérieure ou attendez le mois prochain.`,
      );
    }
    const [call] = await tx
      .insert(aiCalls)
      .values({ userId: user.id, documentId: doc.id, provider: provider.name, model: provider.model, estimatedCostUsd: estimate.maxCostUsd.toFixed(6), status: "pending" })
      .returning({ id: aiCalls.id });
    return call!;
  });

  // 6. Appel IA (hors transaction : peut durer plusieurs dizaines de secondes)
  const started = Date.now();
  const securityAlerts = detectInjection(doc.extractedText);
  try {
    let attachment: { mediaType: AttachmentMediaType; data: Buffer } | undefined;
    if (doc.contentMode === "vision") {
      attachment = { mediaType: doc.mimeType as AttachmentMediaType, data: await getStorage().get(doc.storageKey) };
    }
    const output = await provider.analyze({
      fileName: doc.originalName,
      today: todayIso(),
      text: doc.contentMode === "text" ? doc.extractedText : null,
      attachment,
    });
    const analysis = normalizeAnalysis(output.raw, securityAlerts);

    const updated = await db.transaction(async (tx) => {
      await tx
        .update(aiCalls)
        .set({
          status: "success",
          model: output.model,
          inputTokens: output.inputTokens,
          outputTokens: output.outputTokens,
          costUsd: costUsd(output.model, output.inputTokens, output.outputTokens).toFixed(6),
          durationMs: Date.now() - started,
        })
        .where(eq(aiCalls.id, locked.id));
      const [row] = await tx
        .update(documents)
        .set({
          status: "analyzed",
          analysis,
          analyzedAt: new Date(),
          processingStartedAt: null,
          errorMessage: null,
          title: analysis.titre,
          category: analysis.categorie,
          docType: analysis.type_document,
          organism: analysis.organisme,
          documentDate: analysis.date_document,
          urgency: analysis.niveau_urgence,
          amountDue: analysis.montant_a_payer === null ? null : analysis.montant_a_payer.toFixed(2),
          suspicious: analysis.contenu_suspect,
          updatedAt: new Date(),
        })
        .where(and(eq(documents.id, doc.id), eq(documents.userId, user.id)))
        .returning();
      await replaceAiTasks(tx as unknown as Db, user.id, doc.id, analysis);
      return row!;
    });
    await refreshSearchVector(db, doc.id);
    await logActivity(db, user.id, "document.analyzed", { documentId: doc.id, details: { titre: analysis.titre } });
    return updated;
  } catch (err) {
    const aiErr = err instanceof AiError ? err : new AiError("provider_error", "Erreur interne d'analyse.");
    if (!(err instanceof AiError)) console.error("[ia] erreur d'analyse", err instanceof Error ? err.message : err);
    await db
      .update(aiCalls)
      .set({
        status: aiErr.code === "refusal" ? "refused" : "error",
        errorCode: aiErr.code,
        inputTokens: aiErr.usage.inputTokens,
        outputTokens: aiErr.usage.outputTokens,
        costUsd: costUsd(provider.model, aiErr.usage.inputTokens, aiErr.usage.outputTokens).toFixed(6),
        durationMs: Date.now() - started,
      })
      .where(eq(aiCalls.id, locked.id));
    await db
      .update(documents)
      .set({ status: "failed", processingStartedAt: null, errorMessage: USER_MESSAGES[aiErr.code], updatedAt: new Date() })
      .where(and(eq(documents.id, doc.id), eq(documents.userId, user.id)));
    // L'échec ne vient pas de l'utilisateur : l'analyse lui est rendue.
    await refundAnalysis(db, user.id, period);
    await logActivity(db, user.id, "document.analysis_failed", { documentId: doc.id, details: { raison: aiErr.code } });
    throw new AppError(502, `ai_${aiErr.code}`, USER_MESSAGES[aiErr.code]);
  }
}

/** Remplace les tâches IA encore « à faire » du document (les tâches faites ou manuelles sont conservées). */
async function replaceAiTasks(db: Db, userId: string, documentId: string, analysis: DocumentAnalysis): Promise<void> {
  await db
    .delete(tasks)
    .where(and(eq(tasks.documentId, documentId), eq(tasks.userId, userId), eq(tasks.source, "ai"), eq(tasks.status, "todo")));

  const rows: (typeof tasks.$inferInsert)[] = analysis.actions_requises.map((a) => ({
    userId,
    documentId,
    title: a.action,
    dueDate: a.echeance,
    priority: a.priorite,
    kind: "action",
    source: "ai" as const,
  }));
  // Les échéances non couvertes par une action à la même date deviennent aussi des tâches.
  const coveredDates = new Set(analysis.actions_requises.map((a) => a.echeance).filter(Boolean));
  for (const e of analysis.echeances) {
    if (coveredDates.has(e.date)) continue;
    coveredDates.add(e.date);
    rows.push({
      userId,
      documentId,
      title: e.libelle,
      dueDate: e.date,
      priority: e.type === "paiement" || e.type === "contestation" ? "haute" : "moyenne",
      kind: e.type,
      source: "ai",
    });
  }
  if (rows.length > 0) await db.insert(tasks).values(rows.slice(0, 30));
}
