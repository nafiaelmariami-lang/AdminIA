import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireAdmin } from "@/server/admin/access";
import { listUsers } from "@/server/admin/service";

export const GET = route(async (req) => {
  await requireAdmin(req);
  const url = new URL(req.url);
  const result = await listUsers(await getDb(), { q: url.searchParams.get("q") ?? undefined, page: Number(url.searchParams.get("page")) || 1 });
  return json(result, { headers: { "Cache-Control": "no-store" } });
});
