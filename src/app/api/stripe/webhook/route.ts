import { getDb } from "@/server/db";
import { json, readBodyLimited, route } from "@/server/http";
import { processWebhook } from "@/server/billing/stripe";

/** Webhook Stripe : la signature est vérifiée sur le corps BRUT, avant tout traitement. */
export const POST = route(async (req) => {
  const payload = new TextDecoder().decode(await readBodyLimited(req, 1024 * 1024));
  const result = await processWebhook(await getDb(), payload, req.headers.get("stripe-signature"));
  return json({ received: true, result });
});
