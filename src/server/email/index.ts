import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/server/config";
import { log } from "@/server/logger";

export type EmailMessage = { to: string; subject: string; text: string; html: string; tag: string };

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<void>;
}

export class EmailError extends Error {}

/**
 * Développement et tests : chaque e-mail est écrit dans un fichier JSON (dossier privé, ignoré par Git).
 * Refusé en production.
 */
export class OutboxEmailSender implements EmailSender {
  readonly name = "outbox";
  constructor(private readonly dir: string) {}
  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
    const file = path.join(this.dir, `${Date.now()}-${randomUUID()}.json`);
    await writeFile(file, JSON.stringify({ ...message, sentAt: new Date().toISOString() }, null, 2), { mode: 0o600 });
    // Développement : AUCUN e-mail réel n'est envoyé. Le chemin complet est affiché pour retrouver le lien.
    log.info("email.outbox", { tag: message.tag, note: "e-mail NON envoyé (mode développement) : ouvrez ce fichier", path: file });
  }
}

/** Brevo (ex-Sendinblue, prestataire français) : API transactionnelle HTTP, sans dépendance. */
export class BrevoEmailSender implements EmailSender {
  readonly name = "brevo";
  constructor(
    private readonly apiKey: string,
    private readonly from: { email: string; name: string },
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}
  async send(message: EmailMessage): Promise<void> {
    let res: Response;
    try {
      res = await this.fetchImpl("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": this.apiKey, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          sender: this.from,
          to: [{ email: message.to }],
          subject: message.subject,
          textContent: message.text,
          htmlContent: message.html,
          tags: [message.tag],
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new EmailError("Service d'e-mail injoignable.");
    }
    if (!res.ok) throw new EmailError(`Envoi refusé par le service d'e-mail (${res.status}).`);
  }
}

/** Aucun envoi (ex. maintenance) : l'événement est seulement journalisé. */
export class DisabledEmailSender implements EmailSender {
  readonly name = "disabled";
  async send(message: EmailMessage): Promise<void> {
    log.warn("email.disabled", { tag: message.tag });
  }
}

let override: EmailSender | null = null;
let cached: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (override) return override;
  if (cached) return cached;
  const cfg = getConfig();
  if (cfg.EMAIL_DRIVER === "brevo") cached = new BrevoEmailSender(cfg.BREVO_API_KEY!, { email: cfg.EMAIL_FROM, name: cfg.EMAIL_FROM_NAME });
  else if (cfg.EMAIL_DRIVER === "disabled") cached = new DisabledEmailSender();
  else cached = new OutboxEmailSender(path.resolve(cfg.EMAIL_OUTBOX_DIR));
  return cached;
}

/**
 * Faux si l'envoi est désactivé (EMAIL_DRIVER=disabled, ex. bêta sans prestataire d'e-mail) :
 * les parcours qui reposent sur un lien par e-mail doivent alors le dire, pas prétendre l'avoir envoyé.
 */
export function isEmailDeliveryEnabled(): boolean {
  return getConfig().EMAIL_DRIVER !== "disabled";
}

/** Message commun aux parcours indisponibles sans e-mail. */
export const EMAIL_DISABLED_MESSAGE = "L'envoi d'e-mails n'est pas encore activé sur AdminIA.";

/** Envoi « au mieux » : un échec d'e-mail ne doit jamais faire échouer l'action de l'utilisateur. */
export async function sendEmailSafely(message: EmailMessage): Promise<boolean> {
  try {
    await getEmailSender().send(message);
    return true;
  } catch (err) {
    log.error("email.send_failed", { tag: message.tag, error: err });
    return false;
  }
}

export function setEmailSenderForTests(sender: EmailSender | null): void {
  override = sender;
  cached = null;
}
