import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { tokenFromRequest } from "@/server/auth/session";
import { enableTotp } from "@/server/auth/mfa";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const result = await enableTotp(await getDb(), user, tokenFromRequest(req), await readJson(req));
  return json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
});
