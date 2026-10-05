import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { analyzeDocument } from "@/server/ai/analyze";
import { toDocumentDetail } from "@/server/documents/service";
import { listTasks } from "@/server/tasks/service";

// L'analyse peut prendre jusqu'à ~2 minutes (délai maximal de l'appel IA).
export const maxDuration = 150;

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  const db = await getDb();
  const doc = await analyzeDocument(db, user, id);
  const tasks = await listTasks(db, user.id, { status: "all", documentId: doc.id });
  return json({ document: toDocumentDetail(doc), tasks });
});
