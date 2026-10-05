import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { getOwnedTask, listTasks } from "@/server/tasks/service";
import { buildIcs } from "@/server/tasks/ics";

/** Export agenda (.ics) : toutes les échéances à faire, ou une seule (?id=). */
export const GET = route(async (req) => {
  const user = await requireUser(req);
  const db = await getDb();
  const id = new URL(req.url).searchParams.get("id");
  const items = id ? [await getOwnedTask(db, user.id, id)] : await listTasks(db, user.id, { status: "todo" });
  return new Response(buildIcs(items), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="adminia-echeances.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
});
