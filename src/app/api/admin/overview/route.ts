import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireAdmin } from "@/server/admin/access";
import { getAdminOverview } from "@/server/admin/service";

export const GET = route(async (req) => {
  await requireAdmin(req);
  return json(await getAdminOverview(await getDb()), { headers: { "Cache-Control": "no-store" } });
});
