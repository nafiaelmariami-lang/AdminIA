import "server-only";
import { createHash } from "node:crypto";
import { and, count, desc, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Executor } from "@/server/db";
import { documents } from "@/server/db/schema";
import { AppError, badRequest, notFound } from "@/server/errors";
import { isUuid } from "@/server/http";
import { getPlan, HARD_LIMITS } from "@/lib/plans";
import { omit } from "@/lib/omit";
import { logActivity } from "@/server/activity";
import { enforceRateLimit } from "@/server/security/rate-limit";
import { getSetting } from "@/server/settings";
import { getStorage, newStorageKey } from "@/server/storage";
import { CATEGORIES, cleanText } from "@/server/ai/schema";
import type { SessionUser } from "@/server/auth/session";
import { detectFileType, FileTypeError } from "./file-type";
import { extractContent, ExtractionError } from "./extract";
import { readImageSize } from "./image-info";

export type DocumentRow = typeof documents.$inferSelect;

/** Colonnes renvoyées dans les listes : jamais le texte intégral ni la clé de stockage. */
const listColumns = {
  id: documents.id,
  originalName: documents.originalName,
  mimeType: documents.mimeType,
  sizeBytes: documents.sizeBytes,
  pageCount: documents.pageCount,
  status: documents.status,
  title: documents.title,
  category: documents.category,
  docType: documents.docType,
  organism: documents.organism,
  documentDate: documents.documentDate,
  urgency: documents.urgency,
  amountDue: documents.amountDue,
  suspicious: documents.suspicious,
  createdAt: documents.createdAt,
  analyzedAt: documents.analyzedAt,
};

export type DocumentListItem = { [K in keyof typeof listColumns]: DocumentRow[K] };

/** Nom de fichier affichable : sans chemin, sans caractères de contrôle, longueur bornée. */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document";
  const cleaned = cleanText(base.replace(/[<>:"|?*]/g, "_"), 150);
  return cleaned || "document";
}

/** Met à jour l'index plein texte (français) : titre > organisme/nom > résumé > texte. */
export async function refreshSearchVector(db: Executor, documentId: string): Promise<void> {
  await db.execute(sql`
    UPDATE documents SET search_vector =
      setweight(to_tsvector('french', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('french', coalesce(organism, '') || ' ' || coalesce(original_name, '') || ' ' || coalesce(category, '')), 'B') ||
      setweight(to_tsvector('french', coalesce(analysis->>'resume', '') || ' ' || coalesce(analysis->>'reference', '')), 'B') ||
      setweight(to_tsvector('french', left(coalesce(extracted_text, ''), 100000)), 'C')
    WHERE id = ${documentId}`);
}

export async function uploadDocument(
  db: Executor,
  user: SessionUser,
  file: { name: string; bytes: Buffer },
): Promise<{ document: DocumentListItem; duplicate: boolean }> {
  const plan = getPlan(user.plan);
  if (!(await getSetting(db, "uploads_enabled"))) {
    throw new AppError(503, "uploads_disabled", "L'ajout de documents est temporairement indisponible.");
  }
  await enforceRateLimit(db, `upload:${user.id}`, plan.uploadsPerHour, 3600, "Trop d'ajouts en peu de temps. Réessayez dans une heure.");

  if (file.bytes.length > plan.maxFileBytes) {
    throw new AppError(413, "file_too_large", `Fichier trop volumineux (maximum ${Math.round(plan.maxFileBytes / 1024 / 1024)} Mo avec votre formule).`);
  }

  const fileName = sanitizeFileName(file.name);
  let type;
  try {
    type = detectFileType(file.bytes, fileName);
  } catch (err) {
    if (err instanceof FileTypeError) throw new AppError(415, "unsupported_type", err.message);
    throw err;
  }
  if (type.kind === "image") {
    if (file.bytes.length > HARD_LIMITS.maxImageBytes) {
      throw new AppError(413, "file_too_large", "Image trop lourde (maximum 3,7 Mo). Réduisez sa résolution ou envoyez-la en PDF.");
    }
    const size = readImageSize(file.bytes, type.mime as "image/jpeg" | "image/png" | "image/webp");
    if (!size || size.width === 0 || size.height === 0) throw new AppError(415, "unsupported_type", "Image illisible ou endommagée.");
    if (Math.max(size.width, size.height) > HARD_LIMITS.maxImageSide) {
      throw new AppError(413, "image_too_large", `Image trop grande (${size.width}×${size.height} pixels, maximum ${HARD_LIMITS.maxImageSide}).`);
    }
    if (Math.min(size.width, size.height) < HARD_LIMITS.minImageSide) {
      throw new AppError(422, "image_too_small", "Image trop petite pour être lue. Prenez la photo plus près du document.");
    }
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  // Un même fichier ajouté deux fois n'est pas dupliqué (et ne coûte pas une nouvelle analyse).
  const existing = await db
    .select(listColumns)
    .from(documents)
    .where(and(eq(documents.userId, user.id), eq(documents.sha256, sha256)))
    .limit(1);
  if (existing[0]) return { document: existing[0], duplicate: true };

  const [{ n }] = (await db.select({ n: count() }).from(documents).where(eq(documents.userId, user.id))) as [{ n: number }];
  if (n >= plan.maxDocuments) {
    throw new AppError(403, "storage_quota", `Vous avez atteint la limite de ${plan.maxDocuments} documents de votre formule.`);
  }

  let extraction;
  try {
    extraction = await extractContent(file.bytes, type);
  } catch (err) {
    if (err instanceof ExtractionError) throw new AppError(422, "unreadable", err.message);
    throw err;
  }
  if (extraction.pageCount > plan.maxPages) {
    throw new AppError(413, "too_many_pages", `Document trop long (${extraction.pageCount} pages, maximum ${plan.maxPages} avec votre formule).`);
  }
  if (extraction.mode === "vision" && type.kind === "pdf" && extraction.pageCount > HARD_LIMITS.maxVisionPages) {
    throw new AppError(413, "too_many_pages", `Ce PDF scanné compte ${extraction.pageCount} pages (maximum ${HARD_LIMITS.maxVisionPages} pour un scan).`);
  }
  if (extraction.text && extraction.text.length > HARD_LIMITS.maxTextChars) {
    throw new AppError(413, "too_much_text", "Ce document contient trop de texte pour être analysé. Envoyez uniquement les pages utiles.");
  }

  const storageKey = newStorageKey(user.id);
  const storage = getStorage();
  await storage.put(storageKey, file.bytes);

  let inserted: DocumentListItem;
  try {
    [inserted] = (await db
      .insert(documents)
      .values({
        userId: user.id,
        originalName: fileName,
        mimeType: type.mime,
        sizeBytes: file.bytes.length,
        storageKey,
        sha256,
        pageCount: extraction.pageCount,
        contentMode: extraction.mode,
        extractedText: extraction.text,
        title: fileName.replace(/\.[a-z0-9]{2,5}$/i, ""),
      })
      .returning(listColumns)) as [DocumentListItem];
  } catch (err) {
    await storage.delete(storageKey); // pas de fichier orphelin
    throw err;
  }
  await refreshSearchVector(db, inserted.id);
  await logActivity(db, user.id, "document.uploaded", { documentId: inserted.id, details: { nom: fileName } });
  return { document: inserted, duplicate: false };
}

const listQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.enum(CATEGORIES).optional(),
  status: z.enum(["uploaded", "processing", "analyzed", "failed"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export type ListQuery = z.input<typeof listQuerySchema>;

export async function listDocuments(db: Executor, userId: string, query: ListQuery = {}) {
  const parsed = listQuerySchema.safeParse(query);
  if (!parsed.success) throw badRequest("Paramètres de recherche invalides.");
  const { q, category, status, limit, offset } = parsed.data;

  const conditions: SQL[] = [eq(documents.userId, userId)];
  if (category) conditions.push(eq(documents.category, category));
  if (status) conditions.push(eq(documents.status, status));

  let rank: SQL | null = null;
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(sql`(
      ${documents.searchVector} @@ websearch_to_tsquery('french', ${q})
      OR ${documents.title} ILIKE ${like}
      OR ${documents.originalName} ILIKE ${like}
      OR ${documents.organism} ILIKE ${like}
      OR ${documents.analysis}->>'reference' ILIKE ${like}
    )`);
    rank = sql`ts_rank(${documents.searchVector}, websearch_to_tsquery('french', ${q}))`;
  }
  const where = and(...conditions);
  const rows = await db
    .select(listColumns)
    .from(documents)
    .where(where)
    .orderBy(...(rank ? [desc(rank), desc(documents.createdAt)] : [desc(documents.createdAt)]))
    .limit(limit)
    .offset(offset);
  const [{ total }] = (await db.select({ total: count() }).from(documents).where(where)) as [{ total: number }];
  return { items: rows as DocumentListItem[], total: Number(total), limit, offset };
}

/** Lecture avec contrôle de propriété : un document d'un autre compte est « introuvable » (pas de fuite d'existence). */
export async function getOwnedDocument(db: Executor, userId: string, documentId: unknown): Promise<DocumentRow> {
  if (!isUuid(documentId)) throw notFound("Document");
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, userId)))
    .limit(1);
  if (!rows[0]) throw notFound("Document");
  return rows[0];
}

/** Vue détaillée renvoyée au client : sans clé de stockage, empreinte ni vecteur de recherche. */
export function toDocumentDetail(doc: DocumentRow) {
  const rest = omit(doc, ["storageKey", "sha256", "searchVector", "userId", "extractedText"]);
  const text = doc.extractedText;
  return { ...rest, textPreview: text ? text.slice(0, 5000) : null, textLength: text?.length ?? 0 };
}

const updateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    category: z.enum(CATEGORIES).optional(),
  })
  .strict();

export async function updateDocument(db: Executor, userId: string, documentId: unknown, input: unknown) {
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) throw badRequest("Modification invalide.");
  const doc = await getOwnedDocument(db, userId, documentId);
  const patch = parsed.data;
  if (Object.keys(patch).length === 0) return doc;
  const [updated] = await db
    .update(documents)
    .set({ ...patch, title: patch.title !== undefined ? cleanText(patch.title, 200) : undefined, updatedAt: new Date() })
    .where(and(eq(documents.id, doc.id), eq(documents.userId, userId)))
    .returning();
  await refreshSearchVector(db, doc.id);
  await logActivity(db, userId, "document.updated", { documentId: doc.id });
  return updated!;
}

export async function deleteDocument(db: Executor, userId: string, documentId: unknown): Promise<void> {
  const doc = await getOwnedDocument(db, userId, documentId);
  if (doc.status === "processing" && doc.processingStartedAt && Date.now() - doc.processingStartedAt.getTime() < 5 * 60_000) {
    throw new AppError(409, "processing", "Analyse en cours : réessayez dans quelques instants.");
  }
  await db.delete(documents).where(and(eq(documents.id, doc.id), eq(documents.userId, userId)));
  await getStorage().delete(doc.storageKey);
  await logActivity(db, userId, "document.deleted", { details: { nom: doc.originalName } });
}

export async function readDocumentFile(db: Executor, userId: string, documentId: unknown) {
  const doc = await getOwnedDocument(db, userId, documentId);
  const data = await getStorage().get(doc.storageKey);
  return { doc, data };
}
