import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { clearSessionCookie, invalidateSession, tokenFromRequest, validateSessionToken } from "@/server/auth/session";
import { logActivity } from "@/server/activity";

export const POST = route(async (req) => {
  const db = await getDb();
  const token = tokenFromRequest(req);
  if (token) {
    const user = await validateSessionToken(db, token);
    await invalidateSession(db, token);
    if (user) await logActivity(db, user.id, "auth.logout");
  }
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
});
