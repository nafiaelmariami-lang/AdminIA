import type { Metadata } from "next";
import { ResetPasswordForm } from "@/components/auth/account-link-forms";

export const metadata: Metadata = { title: "Nouveau mot de passe", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = ((await searchParams).token ?? "").slice(0, 100);
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Nouveau mot de passe</h1>
      <p className="mb-6 mt-1 text-slate-600">Choisissez un nouveau mot de passe. Vos autres appareils seront déconnectés.</p>
      <ResetPasswordForm token={token} />
    </>
  );
}
