import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createTask, listTasks } from "@/server/tasks/service";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const s = new URL(req.url).searchParams.get("status");
  const status = s === "done" || s === "all" ? s : "todo";
  return json({ items: await listTasks(await getDb(), user.id, { status }) });
});

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const task = await createTask(await getDb(), user.id, await readJson(req));
  return json({ task }, { status: 201 });
});
