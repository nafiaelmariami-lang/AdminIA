import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { verifyEmail } from "@/server/auth/account-flows";

export const POST = route(async (req) => {
  await verifyEmail(await getDb(), await readJson(req));
  return json({ ok: true });
});
