import { getDb } from "@/server/db";
import { clientIp, json, readJson, route } from "@/server/http";
import { loginUser } from "@/server/auth/service";
import { sessionCookie } from "@/server/auth/session";

export const POST = route(async (req) => {
  const db = await getDb();
  const { userId, token, expiresAt } = await loginUser(db, await readJson(req), clientIp(req));
  return json({ userId }, { headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
});
