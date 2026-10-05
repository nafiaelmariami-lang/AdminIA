import { json, route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";

export const GET = route(async (req) => {
  const user = await requireUser(req);
  return json({ user: { id: user.id, email: user.email, name: user.name, plan: user.plan } });
});
