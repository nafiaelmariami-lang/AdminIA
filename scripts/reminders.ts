/**
 * Envoi des rappels d'échéances (à planifier une fois par jour, ex. 8 h).
 * Simulation : npm run reminders          Envoi : npm run reminders -- --apply
 */
import { getDb } from "@/server/db";
import { runReminders } from "@/server/tasks/reminders";

runReminders(await getDb(), { apply: process.argv.includes("--apply") })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    process.exit(0);
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
