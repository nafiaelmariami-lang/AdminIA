import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { startTotpSetup } from "@/server/auth/mfa";

/** Génère un secret en attente et son QR code ; rien n'est activé avant la saisie d'un code valide. */
export const POST = route(async (req) => {
  const user = await requireUser(req);
  return json(await startTotpSetup(await getDb(), user), { headers: { "Cache-Control": "no-store" } });
});
