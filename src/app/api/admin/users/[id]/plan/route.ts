import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireAdmin } from "@/server/admin/access";
import { setUserPlan } from "@/server/admin/service";

type Ctx = { params: Promise<{ id: string }> };

export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  const { id } = await params;
  return json(await setUserPlan(await getDb(), admin, id, await readJson(req)));
});
