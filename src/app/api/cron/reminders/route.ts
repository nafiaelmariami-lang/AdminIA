import { timingSafeEqual } from "node:crypto";
import { getDb } from "@/server/db";
import { getConfig } from "@/server/config";
import { json, route } from "@/server/http";
import { notFound } from "@/server/errors";
import { runReminders } from "@/server/tasks/reminders";

export const maxDuration = 300;

/** Déclenchement HTTP des rappels (planificateur de l'hébergeur), protégé par CRON_SECRET. */
export const POST = route(async (req) => {
  const secret = getConfig().CRON_SECRET;
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const ok = !!secret && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
  if (!ok) throw notFound("Ressource");
  return json(await runReminders(await getDb(), { apply: true }));
});
