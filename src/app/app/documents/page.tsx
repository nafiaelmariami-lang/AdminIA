import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { getConfig } from "@/server/config";
import { requirePageUser } from "@/server/auth/current-user";
import { listDocuments } from "@/server/documents/service";
import { CATEGORIES } from "@/server/ai/schema";
import { CATEGORY_LABELS } from "@/lib/labels";
import { Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";
import { DocumentRow } from "@/components/app/document-row";
import { UploadDropzone } from "@/components/app/upload-dropzone";
import { isEmailDeliveryEnabled } from "@/server/email";

export const metadata: Metadata = { title: "Documents" };

const PAGE_SIZE = 20;

type SearchParams = Promise<{ q?: string; categorie?: string; page?: string }>;

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").slice(0, 200);
  const category = (CATEGORIES as readonly string[]).includes(sp.categorie ?? "") ? (sp.categorie as (typeof CATEGORIES)[number]) : undefined;
  const page = Math.max(1, Math.min(1000, Number(sp.page) || 1));
  const result = await listDocuments(await getDb(), user.id, { q: q || undefined, category, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  const pages = Math.max(1, Math.ceil(result.total / PAGE_SIZE));

  const href = (p: { q?: string; categorie?: string; page?: number }) => {
    const params = new URLSearchParams();
    if (p.q) params.set("q", p.q);
    if (p.categorie) params.set("categorie", p.categorie);
    if (p.page && p.page > 1) params.set("page", String(p.page));
    const s = params.toString();
    return `/app/documents${s ? `?${s}` : ""}`;
  };

  return (
    <div>
      <PageHeader title="Documents" description="Tous vos documents, classés automatiquement." />

      <details className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm [&[open]>summary]:mb-4">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-semibold text-brand-700">
          <Icon name="plus" className="h-5 w-5" /> Ajouter des documents
        </summary>
        <UploadDropzone compact canAnalyze={!getConfig().EMAIL_VERIFICATION_REQUIRED || !!user.emailVerifiedAt} emailEnabled={isEmailDeliveryEnabled()} />
      </details>

      <form action="/app/documents" method="get" role="search" className="mb-4 flex gap-2">
        {category && <input type="hidden" name="categorie" value={category} />}
        <label className="relative flex-1">
          <span className="sr-only">Rechercher</span>
          <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
          <input
            name="q"
            defaultValue={q}
            maxLength={200}
            placeholder="Rechercher : « CFE », « assurance décennale », un numéro de facture…"
            className="w-full rounded-xl border border-slate-300 bg-white py-3 pl-10 pr-3 text-base shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
        </label>
        <button type="submit" className="rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white hover:bg-brand-700">
          Rechercher
        </button>
      </form>

      <nav className="mb-6 flex gap-2 overflow-x-auto pb-1" aria-label="Filtrer par catégorie">
        <Link href={href({ q })} className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${!category ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}>
          Tous
        </Link>
        {CATEGORIES.map((c) => (
          <Link
            key={c}
            href={href({ q, categorie: c })}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${category === c ? "bg-slate-900 text-white" : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-100"}`}
          >
            {CATEGORY_LABELS[c]}
          </Link>
        ))}
      </nav>

      <Card>
        <div className="border-b border-slate-100 px-5 py-3 text-sm text-slate-500">
          {result.total} document{result.total > 1 ? "s" : ""}
          {q && <> pour « {q} »</>}
        </div>
        {result.items.length === 0 ? (
          <EmptyState icon={q ? "search" : "document"} title={q || category ? "Aucun résultat" : "Aucun document"}>
            {q || category ? "Essayez un autre mot-clé ou retirez le filtre." : "Ajoutez votre premier document pour commencer."}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-slate-100">
            {result.items.map((d) => (
              <DocumentRow key={d.id} doc={d} />
            ))}
          </ul>
        )}
      </Card>

      {pages > 1 && (
        <nav className="mt-6 flex items-center justify-center gap-3 text-sm" aria-label="Pagination">
          {page > 1 && (
            <Link href={href({ q, categorie: category, page: page - 1 })} className="rounded-lg bg-white px-4 py-2 font-medium ring-1 ring-slate-200 hover:bg-slate-50">
              Précédent
            </Link>
          )}
          <span className="text-slate-500">
            Page {page} sur {pages}
          </span>
          {page < pages && (
            <Link href={href({ q, categorie: category, page: page + 1 })} className="rounded-lg bg-white px-4 py-2 font-medium ring-1 ring-slate-200 hover:bg-slate-50">
              Suivant
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
