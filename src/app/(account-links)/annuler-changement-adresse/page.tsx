import type { Metadata } from "next";
import { RevertEmailChange } from "@/components/auth/account-link-forms";

export const metadata: Metadata = { title: "Annuler un changement d'adresse", referrer: "no-referrer" };

export default async function RevertEmailChangePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const token = ((await searchParams).token ?? "").slice(0, 100);
  return (
    <>
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-slate-900">Changement d&apos;adresse non sollicité ?</h1>
      <RevertEmailChange token={token} />
    </>
  );
}
