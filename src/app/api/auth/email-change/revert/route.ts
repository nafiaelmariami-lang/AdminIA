import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { revertEmailChange } from "@/server/auth/email-change";

export const POST = route(async (req) => {
  await revertEmailChange(await getDb(), await readJson(req));
  return json({ ok: true });
});
