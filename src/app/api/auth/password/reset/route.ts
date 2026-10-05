import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { resetPassword } from "@/server/auth/account-flows";
import { sessionCookie } from "@/server/auth/session";

export const POST = route(async (req) => {
  const { token, expiresAt } = await resetPassword(await getDb(), await readJson(req));
  return json({ ok: true }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
});
