import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { listActivity } from "@/server/activity";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const p = new URL(req.url).searchParams;
  const before = p.get("before");
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
  return json({ items: await listActivity(await getDb(), user.id, { limit: Number(p.get("limit")) || 50, before: beforeDate }) });
});
