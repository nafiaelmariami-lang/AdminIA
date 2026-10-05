import { getDb } from "@/server/db";
import { AppError } from "@/server/errors";
import { json, readFormLimited, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { listDocuments, uploadDocument } from "@/server/documents/service";

/** Taille maximale absolue d'une requête d'ajout (la limite de la formule est vérifiée ensuite). */
const MAX_UPLOAD_REQUEST_BYTES = 21 * 1024 * 1024;

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const p = new URL(req.url).searchParams;
  const result = await listDocuments(await getDb(), user.id, {
    q: p.get("q") ?? undefined,
    category: (p.get("category") ?? undefined) as never,
    status: (p.get("status") ?? undefined) as never,
    limit: p.get("limit") ?? undefined,
    offset: p.get("offset") ?? undefined,
  });
  return json(result);
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const form = await readFormLimited(req, MAX_UPLOAD_REQUEST_BYTES);
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(400, "missing_file", "Aucun fichier reçu.");
  if (file.size > MAX_UPLOAD_REQUEST_BYTES) throw new AppError(413, "file_too_large", "Fichier trop volumineux.");
  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await uploadDocument(await getDb(), user, { name: file.name || "document", bytes });
  return json(result, { status: result.duplicate ? 200 : 201 });
});
