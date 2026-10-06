import { getDb } from "@/server/db";
import { json, route } from "@/server/http";
import { requireAdmin } from "@/server/admin/access";
import { verifyUserEmail } from "@/server/admin/service";

type Ctx = { params: Promise<{ id: string }> };

/** Confirmation manuelle de l'adresse d'un utilisateur par un administrateur (journalisée). */
export const POST = route<Ctx>(async (req, { params }) => {
  const admin = await requireAdmin(req);
  const { id } = await params;
  return json(await verifyUserEmail(await getDb(), admin, id));
});
