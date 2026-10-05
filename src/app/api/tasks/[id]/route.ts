import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { deleteTask, updateTask } from "@/server/tasks/service";

type Ctx = { params: Promise<{ id: string }> };

export const PATCH = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  return json({ task: await updateTask(await getDb(), user.id, id, await readJson(req)) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const user = await requireUser(req);
  const { id } = await params;
  await deleteTask(await getDb(), user.id, id);
  return json({ ok: true });
});
