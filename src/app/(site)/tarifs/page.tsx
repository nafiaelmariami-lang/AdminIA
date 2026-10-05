import type { Metadata } from "next";
import { PricingGrid } from "@/components/site/pricing";

export const metadata: Metadata = { title: "Tarifs" };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-center text-4xl font-bold tracking-tight text-slate-900">Tarifs</h1>
      <p className="mx-auto mt-4 max-w-2xl text-center text-slate-600">
        Une analyse = un document lu et expliqué par l&apos;IA. Le stockage, la recherche, l&apos;échéancier et l&apos;export sont inclus dans toutes les formules.
      </p>
      <div className="mt-12">
        <PricingGrid />
      </div>
      <p className="mt-8 text-center text-sm text-slate-500">Prix hors taxes. Sans engagement. Le paiement en ligne sera activé prochainement.</p>
    </div>
  );
}
