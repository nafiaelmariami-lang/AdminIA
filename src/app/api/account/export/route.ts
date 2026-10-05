import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { requireUser } from "@/server/auth/guard";
import { exportAccount } from "@/server/account/service";

export const maxDuration = 120;

export const GET = route(async (req) => {
  const user = await requireUser(req);
  const stream = await exportAccount(await getDb(), user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(stream, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="adminia-export-${date}.zip"`,
      "Cache-Control": "private, no-store",
    },
  });
});
