import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireAdmin } from "@/server/admin/access";
import { updateSetting } from "@/server/admin/service";

export const POST = route(async (req) => {
  const admin = await requireAdmin(req);
  return json(await updateSetting(await getDb(), admin, await readJson(req)));
});
