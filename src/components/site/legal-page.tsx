import type { ReactNode } from "react";

/** Gabarit des pages juridiques. Les textes sont des BROUILLONS à faire valider par un juriste. */
export function LegalPage({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
      <div role="note" className="mb-8 rounded-xl border-2 border-dashed border-amber-400 bg-amber-50 p-4 text-sm text-amber-900">
        <strong>Brouillon — validation juridique requise avant commercialisation.</strong> Ce texte est un modèle de travail. Les éléments entre crochets
        [ … ] doivent être complétés et l&apos;ensemble relu par un professionnel du droit.
      </div>
      <h1 className="text-3xl font-bold tracking-tight text-slate-900">{title}</h1>
      <p className="mt-2 text-sm text-slate-500">Dernière mise à jour : {updated}</p>
      <div className="mt-8 space-y-4 leading-relaxed text-slate-700 [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-slate-900 [&_li]:ml-5 [&_li]:list-disc [&_table]:w-full [&_td]:border [&_td]:border-slate-200 [&_td]:p-2 [&_th]:border [&_th]:border-slate-200 [&_th]:bg-slate-50 [&_th]:p-2 [&_th]:text-left">
        {children}
      </div>
    </article>
  );
}
