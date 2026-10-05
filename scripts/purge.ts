/**
 * Purge de conservation des données (à planifier quotidiennement).
 * Simulation : npm run purge          Application : npm run purge -- --apply
 */
import { getDb } from "@/server/db";
import { getConfig } from "@/server/config";
import { runPurge } from "@/server/maintenance";

async function main() {
  const apply = process.argv.includes("--apply");
  const report = await runPurge(await getDb(), { apply, storageDir: getConfig().STORAGE_DIR });
  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.log("Simulation uniquement. Relancez avec --apply pour appliquer.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
