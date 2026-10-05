import { getDb } from "@/server/db";
import { json, readJson, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { deleteAccount, getAccountSummary } from "@/server/account/service";
import { clearSessionCookie } from "@/server/auth/session";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return json(await getAccountSummary(await getDb(), user.id));
});

export const DELETE = route(async (req) => {
  const user = await requireUser(req);
  await deleteAccount(await getDb(), user.id, await readJson(req));
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
});
