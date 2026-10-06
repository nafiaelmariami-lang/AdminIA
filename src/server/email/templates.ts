import type { EmailMessage } from "./index";

/** Gabarits d'e-mails transactionnels (texte + HTML sobre, sans image ni traceur). */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(title: string, paragraphs: string[], button?: { label: string; url: string }, footer?: string): string {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f6f8fb;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #e2e8f0;border-radius:12px">
<tr><td style="padding:24px 28px">
<p style="margin:0 0 16px;font-size:18px;font-weight:bold">Admin<span style="color:#2554e8">IA</span></p>
<h1 style="margin:0 0 16px;font-size:20px">${esc(title)}</h1>
${paragraphs.map((p) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.5">${esc(p)}</p>`).join("\n")}
${button ? `<p style="margin:24px 0"><a href="${esc(button.url)}" style="background:#2554e8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:bold;display:inline-block">${esc(button.label)}</a></p><p style="margin:0 0 12px;font-size:12px;color:#64748b">Si le bouton ne fonctionne pas, copiez ce lien : ${esc(button.url)}</p>` : ""}
${footer ? `<p style="margin:24px 0 0;font-size:12px;color:#64748b">${esc(footer)}</p>` : ""}
</td></tr></table></td></tr></table></body></html>`;
}

function text(title: string, paragraphs: string[], button?: { label: string; url: string }, footer?: string): string {
  return [title, "", ...paragraphs, ...(button ? ["", `${button.label} : ${button.url}`] : []), ...(footer ? ["", footer] : []), "", "— AdminIA"].join("\n");
}

function build(tag: string, to: string, subject: string, title: string, paragraphs: string[], button?: { label: string; url: string }, footer?: string): EmailMessage {
  return { tag, to, subject, text: text(title, paragraphs, button, footer), html: layout(title, paragraphs, button, footer) };
}

const SECURITY_FOOTER = "AdminIA ne vous demandera jamais votre mot de passe par e-mail.";

export const emails = {
  verifyEmail: (to: string, name: string, url: string) =>
    build(
      "verify_email",
      to,
      "Confirmez votre adresse e-mail",
      `Bienvenue ${name} !`,
      ["Confirmez votre adresse e-mail pour activer l'analyse de vos documents.", "Ce lien est valable 48 heures."],
      { label: "Confirmer mon adresse", url },
      "Vous n'avez pas créé de compte AdminIA ? Ignorez simplement cet e-mail.",
    ),
  resetPassword: (to: string, url: string) =>
    build(
      "reset_password",
      to,
      "Réinitialisation de votre mot de passe",
      "Réinitialiser votre mot de passe",
      ["Vous avez demandé à réinitialiser votre mot de passe AdminIA.", "Ce lien est valable 1 heure et ne peut servir qu'une fois."],
      { label: "Choisir un nouveau mot de passe", url },
      `Vous n'êtes pas à l'origine de cette demande ? Ignorez cet e-mail : votre mot de passe reste inchangé. ${SECURITY_FOOTER}`,
    ),
  passwordChanged: (to: string, resetUrl: string) =>
    build(
      "password_changed",
      to,
      "Votre mot de passe a été modifié",
      "Mot de passe modifié",
      ["Le mot de passe de votre compte AdminIA vient d'être modifié. Les autres appareils connectés ont été déconnectés."],
      { label: "Ce n'était pas moi : sécuriser mon compte", url: resetUrl },
      SECURITY_FOOTER,
    ),
  mfaChanged: (to: string, enabled: boolean) =>
    build(
      enabled ? "mfa_enabled" : "mfa_disabled",
      to,
      enabled ? "Double authentification activée" : "Double authentification désactivée",
      enabled ? "Double authentification activée" : "Double authentification désactivée",
      [
        enabled
          ? "La double authentification vient d'être activée sur votre compte AdminIA. Conservez vos codes de secours en lieu sûr."
          : "La double authentification vient d'être désactivée sur votre compte AdminIA.",
        "Si vous n'êtes pas à l'origine de ce changement, réinitialisez immédiatement votre mot de passe et contactez-nous.",
      ],
      undefined,
      SECURITY_FOOTER,
    ),
  reminderDigest: (to: string, name: string, items: { title: string; when: string }[], appUrl: string, unsubscribeUrl: string) =>
    build(
      "reminder_digest",
      to,
      items.length > 1 ? `${items.length} échéances approchent` : `Échéance : ${items[0]?.title ?? ""}`.slice(0, 120),
      `Bonjour ${name}, vos prochaines échéances`,
      items.map((i) => `• ${i.when} — ${i.title}`),
      { label: "Voir mes échéances", url: `${appUrl}/app/echeances` },
      `Vous recevez ce rappel car vous l'avez activé. Se désabonner : ${unsubscribeUrl}`,
    ),
  inactivityNotice: (to: string, name: string, deletionDate: string, loginUrl: string) =>
    build(
      "inactivity_notice",
      to,
      "Votre compte AdminIA sera bientôt supprimé",
      `Bonjour ${name}`,
      [
        "Votre compte AdminIA n'a pas été utilisé depuis près de deux ans.",
        `Conformément à notre politique de conservation, il sera supprimé avec tous vos documents le ${deletionDate}.`,
        "Pour le conserver, il vous suffit de vous connecter. Vous pouvez aussi exporter vos données depuis votre espace.",
      ],
      { label: "Me connecter", url: loginUrl },
    ),
};
