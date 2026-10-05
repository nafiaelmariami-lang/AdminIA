import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { resendVerificationEmail } from "@/server/auth/account-flows";

export const POST = route(async (req) => {
  const user = await requireUser(req);
  await resendVerificationEmail(await getDb(), user);
  return json({ ok: true });
});
