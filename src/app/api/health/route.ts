import { sql } from "drizzle-orm";
import { getDb } from "@/server/db";
import { json } from "@/server/http";

export const dynamic = "force-dynamic";

/** Sonde de santé : ne révèle aucune information de configuration. */
export async function GET() {
  try {
    await (await getDb()).execute(sql`SELECT 1`);
    return json({ status: "ok" });
  } catch {
    return json({ status: "degraded" }, { status: 503 });
  }
}
