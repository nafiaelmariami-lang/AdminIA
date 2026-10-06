import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { resetPassword } from "@/server/auth/account-flows";
import { sessionCookie } from "@/server/auth/session";

export const POST = route(async (req) => {
  const result = await resetPassword(await getDb(), await readJson(req));
  // Compte protégé par la double authentification : il faut se reconnecter avec le second facteur.
  if (result.loginRequired) return json({ ok: true, loginRequired: true });
  return json({ ok: true, loginRequired: false }, { headers: { "Set-Cookie": sessionCookie(result.token, result.expiresAt) } });
});
