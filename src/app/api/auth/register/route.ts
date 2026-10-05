import { getDb } from "@/server/db";
import { clientIp, json, readJson, route } from "@/server/http";
import { registerUser } from "@/server/auth/service";
import { sessionCookie } from "@/server/auth/session";

export const POST = route(async (req) => {
  const db = await getDb();
  const { userId, token, expiresAt } = await registerUser(db, await readJson(req), clientIp(req));
  return json({ userId }, { status: 201, headers: { "Set-Cookie": sessionCookie(token, expiresAt) } });
});
