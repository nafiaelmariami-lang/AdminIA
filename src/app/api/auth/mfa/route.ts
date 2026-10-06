import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { completeMfaLogin } from "@/server/auth/mfa";
import { sessionCookie } from "@/server/auth/session";

/** Seconde étape de connexion : code de l'application ou code de secours. */
export const POST = route(async (req) => {
  const { userId, token, expiresAt } = await completeMfaLogin(await getDb(), await readJson(req));
  return json({ userId }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
});
