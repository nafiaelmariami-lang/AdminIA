/**
 * Diagnostic avant mise en service : npm run doctor
 * Vérifie la configuration, la base, les migrations, le stockage (aller-retour chiffré)
 * et l'état des fournisseurs — sans envoyer d'e-mail ni appeler l'IA (aucun coût).
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db";
import { queryRows } from "@/server/db/rows";
import { getStorage } from "@/server/storage";
import { getSetting, SETTING_DEFAULTS, type SettingKey } from "@/server/settings";

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const add = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function main() {
  let cfg;
  try {
    cfg = getConfig();
    add("Configuration", true, `NODE_ENV=${cfg.NODE_ENV}, APP_URL=${cfg.APP_URL}`);
  } catch (err) {
    add("Configuration", false, err instanceof Error ? err.message : String(err));
    return;
  }

  try {
    const db = await getDb();
    await db.execute(sql`SELECT 1`);
    add("Base de données", true, cfg.DATABASE_URL.startsWith("pglite:") ? "PGlite (développement)" : "PostgreSQL joignable");
    const expected = readdirSync(path.join(process.cwd(), "drizzle")).filter((f) => f.endsWith(".sql")).length;
    const applied = await queryRows<{ n: number }>(db, sql`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`).catch(() => [{ n: 0 }]);
    const n = Number(applied[0]?.n ?? 0);
    add("Migrations", n === expected, `${n}/${expected} appliquées${n < expected ? " — lancez npm run db:migrate" : ""}`);
    for (const k of Object.keys(SETTING_DEFAULTS) as SettingKey[]) {
      const v = await getSetting(db, k);
      add(`Interrupteur ${k}`, true, v ? "activé" : "DÉSACTIVÉ");
    }
  } catch (err) {
    add("Base de données", false, err instanceof Error ? err.message : String(err));
  }

  try {
    const storage = getStorage();
    const key = `00000000-0000-4000-8000-000000000000/${randomUUID()}`;
    await storage.put(key, Buffer.from("diagnostic"));
    const back = (await storage.get(key)).toString();
    await storage.delete(key);
    add("Stockage", back === "diagnostic", `pilote ${storage.name}, aller-retour chiffré ${back === "diagnostic" ? "OK" : "en échec"}`);
    if (cfg.NODE_ENV === "production" && storage.name === "local") add("Stockage multi-instance", false, "stockage local : une seule instance possible (STORAGE_DRIVER=s3 recommandé)");
  } catch (err) {
    add("Stockage", false, err instanceof Error ? err.message : String(err));
  }

  add("E-mail", cfg.EMAIL_DRIVER !== "outbox" || cfg.NODE_ENV !== "production", `pilote ${cfg.EMAIL_DRIVER}, expéditeur ${cfg.EMAIL_FROM}`);
  add("IA", cfg.AI_PROVIDER === "anthropic" || cfg.NODE_ENV !== "production", `${cfg.AI_PROVIDER}${cfg.AI_PROVIDER === "anthropic" ? ` (${cfg.AI_MODEL})` : " — mode démonstration"}, ${cfg.AI_ENABLED ? "activée" : "COUPÉE"}`);
  add("Budgets IA", true, `${cfg.AI_MAX_COST_PER_DOC_USD} $/document, ${cfg.AI_USER_DAILY_BUDGET_USD} $/utilisateur/jour, ${cfg.AI_DAILY_BUDGET_USD} $/jour au total`);
}

main()
  .catch((err) => add("Diagnostic", false, err instanceof Error ? err.message : String(err)))
  .finally(() => {
    for (const c of checks) console.log(`${c.ok ? "✔" : "✘"} ${c.name.padEnd(28)} ${c.detail}`);
    const failed = checks.filter((c) => !c.ok).length;
    console.log(failed ? `\n${failed} point(s) à corriger.` : "\nTout est prêt.");
    process.exit(failed ? 1 : 0);
  });
