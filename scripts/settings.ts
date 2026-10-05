/**
 * Interrupteurs de fonctionnalités (coupe-circuits), sans redéploiement.
 *   npm run settings                              → affiche l'état
 *   npm run settings -- ai_analysis_enabled false → coupe l'analyse IA
 */
import { getDb } from "@/server/db";
import { getSetting, setSetting, SETTING_DEFAULTS, type SettingKey } from "@/server/settings";

async function main() {
  const db = await getDb();
  const [key, value] = process.argv.slice(2);
  if (key) {
    if (!(key in SETTING_DEFAULTS) || (value !== "true" && value !== "false")) {
      console.error(`Usage : npm run settings -- <${Object.keys(SETTING_DEFAULTS).join("|")}> <true|false>`);
      process.exit(1);
    }
    await setSetting(db, key as SettingKey, value === "true");
  }
  for (const k of Object.keys(SETTING_DEFAULTS) as SettingKey[]) console.log(`${k} = ${await getSetting(db, k)}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
