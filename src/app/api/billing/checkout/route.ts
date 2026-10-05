import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createCheckoutSession } from "@/server/billing/stripe";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return json({ url: await createCheckoutSession(await getDb(), user, await readJson(req)) });
});
