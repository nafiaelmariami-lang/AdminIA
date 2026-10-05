import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createCalendarFeed, revokeCalendarFeed } from "@/server/notifications";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return json({ url: await createCalendarFeed(await getDb(), user.id) }, { status: 201 });
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  await revokeCalendarFeed(await getDb(), user.id);
  return json({ ok: true });
});
