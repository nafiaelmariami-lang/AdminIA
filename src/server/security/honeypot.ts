import "server-only";
import { log } from "@/server/logger";

/**
 * Champ piège invisible pour les humains (ni affiché, ni accessible au clavier, ni lu par
 * les lecteurs d'écran) mais rempli par les robots qui complètent tous les champs.
 * Alternative sans prestataire externe à un CAPTCHA, en complément des limites de fréquence.
 */
import { HONEYPOT_FIELD } from "@/lib/honeypot";

export { HONEYPOT_FIELD };

export function isHoneypotTriggered(input: unknown, route: string): boolean {
  const value = (input as Record<string, unknown> | null)?.[HONEYPOT_FIELD];
  const triggered = typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null && value !== false;
  if (triggered) log.warn("security.honeypot_triggered", { route });
  return triggered;
}
