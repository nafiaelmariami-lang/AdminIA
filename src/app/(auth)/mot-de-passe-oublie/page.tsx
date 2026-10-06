import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/components/auth/account-link-forms";
import { Alert, buttonClass } from "@/components/ui/primitives";
import { isEmailDeliveryEnabled } from "@/server/email";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  if (!isEmailDeliveryEnabled()) {
    // Même message pour tous : ne révèle pas quelles adresses sont inscrites.
    return (
      <>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mot de passe oublié</h1>
        <div className="mb-6 mt-4">
          <Alert tone="warning" title="Réinitialisation par e-mail indisponible pour le moment">
            Pendant la bêta, l&apos;envoi d&apos;e-mails n&apos;est pas encore activé : aucun lien ne peut vous être envoyé. Contactez l&apos;équipe AdminIA
            qui vous a invité(e).
          </Alert>
        </div>
        <Link href="/connexion" className={buttonClass("secondary", "w-full")}>
          Retour à la connexion
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mot de passe oublié</h1>
      <p className="mb-6 mt-1 text-slate-600">Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <ForgotPasswordForm />
    </>
  );
}
