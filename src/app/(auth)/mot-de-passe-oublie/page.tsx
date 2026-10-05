import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/account-link-forms";

export const metadata: Metadata = { title: "Mot de passe oublié" };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mot de passe oublié</h1>
      <p className="mb-6 mt-1 text-slate-600">Indiquez votre adresse : vous recevrez un lien pour choisir un nouveau mot de passe.</p>
      <ForgotPasswordForm />
    </>
  );
}
