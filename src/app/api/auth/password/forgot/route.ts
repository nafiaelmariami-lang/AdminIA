import { getDb } from "@/server/db";
import { clientIp, json, readJson, route } from "@/server/http";
import { requestPasswordReset } from "@/server/auth/account-flows";

export const POST = route(async (req) => {
  await requestPasswordReset(await getDb(), await readJson(req), clientIp(req));
  // Réponse identique que le compte existe ou non.
  return json({ ok: true, message: "Si un compte existe pour cette adresse, un e-mail de réinitialisation vient d'être envoyé." });
});
