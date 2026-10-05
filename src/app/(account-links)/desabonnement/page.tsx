import type { Metadata } from "next";
import { UnsubscribeForm } from "@/components/auth/unsubscribe-form";

export const metadata: Metadata = { title: "Se désabonner des rappels", referrer: "no-referrer" };

export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ u?: string; t?: string }> }) {
  const sp = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Rappels par e-mail</h1>
      <p className="mb-6 mt-1 text-slate-600">Vous ne recevrez plus de rappels d&apos;échéances. Vos documents et échéances restent accessibles dans votre espace.</p>
      <UnsubscribeForm u={(sp.u ?? "").slice(0, 40)} t={(sp.t ?? "").slice(0, 100)} />
    </>
  );
}
