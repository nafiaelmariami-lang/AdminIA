import "server-only";
import { eq } from "drizzle-orm";
import type { Executor } from "@/server/db";
import { appSettings } from "@/server/db/schema";

/**
 * Interrupteurs de fonctionnalités modifiables sans redéploiement (npm run settings).
 * Permettent de couper temporairement les fonctions coûteuses.
 */
export const SETTING_DEFAULTS = {
  ai_analysis_enabled: true,
  uploads_enabled: true,
  registrations_enabled: true,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

export async function getSetting(db: Executor, key: SettingKey): Promise<boolean> {
  const rows = await db.select().from(appSettings).where(eq(appSettings.key, key)).limit(1);
  const value = rows[0]?.value;
  return typeof value === "boolean" ? value : SETTING_DEFAULTS[key];
}

export async function setSetting(db: Executor, key: SettingKey, value: boolean): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}
