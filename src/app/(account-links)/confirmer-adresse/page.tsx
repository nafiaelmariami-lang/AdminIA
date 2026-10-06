import type { Metadata } from "next";
import { ConfirmNewEmail } from "@/components/auth/account-link-forms";

export const metadata: Metadata = { title: "Confirmation de la nouvelle adresse", referrer: "no-referrer" };

export default async function ConfirmNewEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = ((await searchParams).token ?? "").slice(0, 100);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">Nouvelle adresse e-mail</h1>
      <ConfirmNewEmail token={token} />
    </>
  );
}
