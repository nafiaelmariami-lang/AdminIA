import { getDb } from "@/server/db";
import { clientIp, json, readJson, route } from "@/server/http";
import { loginUser } from "@/server/auth/service";
import { sessionCookie } from "@/server/auth/session";

export const POST = route(async (req) => {
  const db = await getDb();
  const result = await loginUser(db, await readJson(req), clientIp(req));
  // Second facteur attendu : aucun cookie de session tant que le code n'est pas vérifié.
  if (result.mfaRequired) return json({ mfaRequired: true, challenge: result.challenge });
  return json({ userId: result.userId }, { headers: { "Set-Cookie": sessionCookie(result.token, result.expiresAt) } });
});
