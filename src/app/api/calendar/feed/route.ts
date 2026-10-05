import { getDb } from "@/server/db";
import { route } from "@/server/http";
import { calendarFeedFor } from "@/server/notifications";

/** Flux d'agenda privé (abonnement depuis Google Agenda, Outlook, Apple), protégé par un jeton secret. */
export const GET = route(async (req) => {
  const ics = await calendarFeedFor(await getDb(), new URL(req.url).searchParams.get("token"));
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "private, max-age=900",
      "X-Robots-Tag": "noindex",
    },
  });
});
