import type { Metadata } from "next";
import { VerifyEmail } from "@/components/auth/account-link-forms";

export const metadata: Metadata = { title: "Confirmation de l'adresse e-mail", referrer: "no-referrer" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = ((await searchParams).token ?? "").slice(0, 100);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">Confirmation de votre adresse</h1>
      <VerifyEmail token={token} />
    </>
  );
}
