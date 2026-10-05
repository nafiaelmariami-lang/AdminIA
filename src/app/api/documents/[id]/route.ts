import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { deleteDocument, getOwnedDocument, toDocumentDetail, updateDocument } from "@/server/documents/service";
import { listTasks } from "@/server/tasks/service";

type Ctx = { params: Promise<{ id: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const db = await getDb();
  const doc = await getOwnedDocument(db, user.id, id);
  const tasks = await listTasks(db, user.id, { status: "all", documentId: doc.id });
  return json({ document: toDocumentDetail(doc), tasks });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const doc = await updateDocument(await getDb(), user.id, id, await readJson(req));
  return json({ document: toDocumentDetail(doc) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteDocument(await getDb(), user.id, id);
  return json({ ok: true });
});
