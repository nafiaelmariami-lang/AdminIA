import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { disableTotp } from "@/server/auth/mfa";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  const result = await disableTotp(await getDb(), user, await readJson(req));
  return json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
});
