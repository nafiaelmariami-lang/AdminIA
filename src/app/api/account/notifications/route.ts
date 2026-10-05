import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { updateNotificationPrefs } from "@/server/notifications";

export const PATCH = route(async (req) => {
  const user = await requireUser(req);
  return json(await updateNotificationPrefs(await getDb(), user.id, await readJson(req)));
});
