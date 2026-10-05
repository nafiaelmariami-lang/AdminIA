import type { Metadata } from "next";
import Link from "next/link";
import { getDb } from "@/server/db";
import { requirePageUser } from "@/server/auth/current-user";
import { listActivity } from "@/server/activity";
import { formatDateTime } from "@/lib/format";
import { ACTIVITY_LABELS } from "@/lib/labels";
import { Card, PageHeader } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Historique" };

export default async function HistoryPage() {
  const user = await requirePageUser();
  const items = await listActivity(await getDb(), user.id, { limit: 200 });
  return (
    <div>
      <PageHeader title="Historique" description="Les 200 dernières actions sur votre compte. Conservé 12 mois." />
      <Card>
        {items.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">Aucune activité.</p>
        ) : (
          <ol className="divide-y divide-slate-100">
            {items.map((i) => {
              const name = typeof i.details?.titre === "string" ? i.details.titre : typeof i.details?.nom === "string" ? i.details.nom : null;
              return (
                <li key={i.id} className="flex flex-col gap-0.5 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4">
                  <time className="w-44 shrink-0 text-slate-500" dateTime={i.createdAt.toISOString()}>
                    {formatDateTime(i.createdAt)}
                  </time>
                  <span className="font-medium text-slate-900">{ACTIVITY_LABELS[i.action] ?? i.action}</span>
                  {name &&
                    (i.documentId && i.action.startsWith("document.") && i.action !== "document.deleted" ? (
                      <Link href={`/app/documents/${i.documentId}`} className="truncate text-brand-700 hover:underline">
                        {name}
                      </Link>
                    ) : (
                      <span className="truncate text-slate-600">{name}</span>
                    ))}
                </li>
              );
            })}
          </ol>
        )}
      </Card>
    </div>
  );
}
