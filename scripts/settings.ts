/**
 * Interrupteurs de fonctionnalités (coupe-circuits), sans redéploiement.
 *   npm run settings                              → affiche l'état
 *   npm run settings -- ai_analysis_enabled false → coupe l'analyse IA
 *   npm run settings -- uploads_enabled false     → coupe l'ajout de documents
 *   npm run settings -- registrations_enabled false → ferme les inscriptions
 */
import { getDb } from "@/server/db";
import { getSetting, parseSettingCommand, setSetting, SETTING_DEFAULTS, type SettingKey } from "@/server/settings";

async function main() {
  const cmd = parseSettingCommand(process.argv.slice(2));
  if (cmd.action === "error") {
    console.error(`${cmd.message}\nUsage : npm run settings -- <clé> <true|false>`);
    process.exit(1);
  }
  const db = await getDb();
  if (cmd.action === "set") await setSetting(db, cmd.key, cmd.value);
  for (const k of Object.keys(SETTING_DEFAULTS) as SettingKey[]) console.log(`${k} = ${await getSetting(db, k)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
