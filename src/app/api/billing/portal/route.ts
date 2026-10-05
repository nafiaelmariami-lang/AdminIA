import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { createPortalSession } from "@/server/billing/stripe";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  return json({ url: await createPortalSession(await getDb(), user.id) });
});
