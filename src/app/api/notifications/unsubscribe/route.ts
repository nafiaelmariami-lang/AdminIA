import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { unsubscribeReminders } from "@/server/notifications";

export const POST = route(async (req) => {
  await unsubscribeReminders(await getDb(), await readJson(req));
  return json({ ok: true });
});
