import Link from "next/link";
import { Icon } from "@/components/ui/icon";
import { CategoryBadge, UrgencyBadge } from "@/components/ui/primitives";
import { formatAmount, formatDate } from "@/lib/format";
import { DOC_TYPE_LABELS, STATUS_LABELS } from "@/lib/labels";

export type DocumentRowView = {
  id: string;
  title: string | null;
  originalName: string;
  status: string;
  category: string | null;
  docType: string | null;
  organism: string | null;
  documentDate: string | null;
  urgency: string | null;
  amountDue: string | null;
  suspicious: boolean;
  createdAt: Date | string;
};

export function DocumentRow({ doc }: { doc: DocumentRowView }) {
  const analyzed = doc.status === "analyzed";
  return (
    <li>
      <Link href={`/app/documents/${doc.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-slate-50">
        <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500 sm:flex">
          <Icon name="document" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-semibold text-slate-900">{doc.title || doc.originalName}</p>
            {doc.suspicious && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-800">
                <Icon name="alert" className="h-3 w-3" /> Suspect
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-sm text-slate-500">
            {analyzed ? [doc.organism, doc.docType ? DOC_TYPE_LABELS[doc.docType] : null, doc.documentDate ? formatDate(doc.documentDate) : null].filter(Boolean).join(" · ") : STATUS_LABELS[doc.status]}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 sm:hidden">
            <CategoryBadge category={doc.category} />
            <UrgencyBadge level={doc.urgency} />
          </div>
        </div>
        <div className="hidden shrink-0 flex-col items-end gap-1.5 sm:flex">
          <div className="flex items-center gap-2">
            <CategoryBadge category={doc.category} />
            <UrgencyBadge level={doc.urgency} />
          </div>
          {doc.amountDue && <p className="text-sm font-semibold text-slate-900">{formatAmount(doc.amountDue)}</p>}
        </div>
        <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-slate-300" />
      </Link>
    </li>
  );
}
