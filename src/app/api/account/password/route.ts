import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { changePassword } from "@/server/auth/account-flows";
import { tokenFromRequest } from "@/server/auth/session";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  await changePassword(await getDb(), user, tokenFromRequest(req), await readJson(req));
  return json({ ok: true });
});
