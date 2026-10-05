import "server-only";
import { getDb } from "@/server/db";
import { unauthorized } from "@/server/errors";
import { tokenFromRequest, validateSessionToken, type SessionUser } from "./session";

/** Routes API : utilisateur authentifié ou erreur 401. L'identité vient UNIQUEMENT de la session serveur. */
export async function requireUser(req: Request): Promise<SessionUser> {
  const db = await getDb();
  const user = await validateSessionToken(db, tokenFromRequest(req));
  if (!user) throw unauthorized();
  return user;
}
