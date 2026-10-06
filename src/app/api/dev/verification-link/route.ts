import { json, route } from "@/server/http";
import { notFound } from "@/server/errors";
import { requireUser } from "@/server/auth/guard";
import { isDevOutboxEnabled, latestVerificationLink } from "@/server/email/dev-outbox";

/** DÉVELOPPEMENT uniquement : dernier lien de confirmation de l'utilisateur connecté (404 ailleurs). */
export const GET = route(async (req) => {
  if (!isDevOutboxEnabled()) throw notFound("Ressource");
  const user = await requireUser(req);
  const link = await latestVerificationLink(user.email);
  if (!link) throw notFound("Lien de confirmation");
  return json({ link });
});
