import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { mfaStatus } from "@/server/auth/mfa";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return json(await mfaStatus(await getDb(), user.id));
});
