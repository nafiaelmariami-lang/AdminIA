import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { EMAIL_CHANGE_SENT, cancelEmailChange, requestEmailChange } from "@/server/auth/email-change";

/** Demande de changement d'adresse : mot de passe (et code de double authentification s'il est actif). */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  await requestEmailChange(await getDb(), user, await readJson(req));
  return json({ ok: true, message: EMAIL_CHANGE_SENT });
});

/** Annule une demande en attente. */
export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  await cancelEmailChange(await getDb(), user);
  return json({ ok: true });
});
