import "server-only";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getConfig } from "@/server/config";

/**
 * Aide au DÉVELOPPEMENT uniquement : en mode « outbox », aucun e-mail réel n'est envoyé ;
 * on retrouve ici le dernier lien de confirmation adressé à un utilisateur.
 * Désactivé (null) dès que l'on n'est pas en développement avec le pilote « outbox ».
 */
export function isDevOutboxEnabled(): boolean {
  const cfg = getConfig();
  return cfg.NODE_ENV === "development" && cfg.EMAIL_DRIVER === "outbox";
}

export function devOutboxDir(): string {
  return path.resolve(getConfig().EMAIL_OUTBOX_DIR);
}

export async function latestVerificationLink(email: string): Promise<string | null> {
  if (!isDevOutboxEnabled()) return null;
  const dir = devOutboxDir();
  const files = (await readdir(dir).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort().reverse();
  for (const f of files.slice(0, 500)) {
    try {
      const m = JSON.parse(await readFile(path.join(dir, f), "utf8")) as { to?: string; tag?: string; text?: string };
      if (m.to !== email || m.tag !== "verify_email") continue;
      const url = /https?:\/\/\S+?\/verifier-email\?token=[A-Za-z0-9_-]+/.exec(m.text ?? "")?.[0];
      if (url) {
        const u = new URL(url);
        return `${u.pathname}${u.search}`; // lien relatif : fonctionne quel que soit le port local
      }
    } catch {
      // fichier illisible : ignoré
    }
  }
  return null;
}
