import Link from "next/link";
import { getDb } from "@/server/db";
import { getConfig } from "@/server/config";
import { requirePageUser } from "@/server/auth/current-user";
import { getDashboard } from "@/server/dashboard";
import { daysUntil } from "@/lib/format";
import { Card, CardHeader, EmptyState } from "@/components/ui/primitives";
import { Icon, type IconName } from "@/components/ui/icon";
import { UploadDropzone } from "@/components/app/upload-dropzone";
import { isEmailDeliveryEnabled } from "@/server/email";
import { TaskList } from "@/components/app/task-list";
import { DocumentRow } from "@/components/app/document-row";

function Stat({ icon, label, value, tone = "default", href }: { icon: IconName; label: string; value: string | number; tone?: "default" | "danger" | "warning"; href?: string }) {
  const tones = { default: "bg-brand-50 text-brand-700", danger: "bg-red-50 text-red-700", warning: "bg-orange-50 text-orange-700" };
  const content = (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tones[tone]}`}>
        <Icon name={icon} />
      </span>
      <div className="min-w-0">
        <p className="text-2xl font-bold leading-none text-slate-900">{value}</p>
        <p className="mt-1 text-xs leading-snug text-slate-500" data-testid="stat-label">
          {label}
        </p>
      </div>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

export default async function DashboardPage() {
  const user = await requirePageUser();
  const data = await getDashboard(await getDb(), user);
  const dated = data.todo.filter((t) => t.dueDate);
  const late = dated.filter((t) => daysUntil(t.dueDate!) < 0).length;
  const soon = dated.filter((t) => {
    const d = daysUntil(t.dueDate!);
    return d >= 0 && d <= 30;
  }).length;
  const remaining = Math.max(0, data.plan.analysesPerMonth - data.analysesUsed);
  const firstName = user.name.split(" ")[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Bonjour {firstName}</h1>
        <p className="mt-1 text-slate-600">
          {late > 0 ? `Attention : ${late} échéance${late > 1 ? "s" : ""} dépassée${late > 1 ? "s" : ""}.` : data.todo.length > 0 ? "Voici ce qui vous attend." : "Tout est à jour. Ajoutez votre prochain courrier quand il arrive."}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 [&>*]:min-w-0">
        <Stat icon="alert" label="En retard" value={late} tone={late ? "danger" : "default"} href="/app/echeances" />
        <Stat icon="clock" label="Échéances sous 30 jours" value={soon} tone={soon ? "warning" : "default"} href="/app/echeances" />
        <Stat icon="check" label="Actions à faire" value={data.todo.length} href="/app/echeances" />
        <Stat icon="sparkles" label="Analyses IA restantes" value={`${remaining}/${data.plan.analysesPerMonth}`} href="/app/compte" />
      </div>

      <UploadDropzone canAnalyze={!getConfig().EMAIL_VERIFICATION_REQUIRED || !!user.emailVerifiedAt} emailEnabled={isEmailDeliveryEnabled()} />

      {data.attention.length > 0 && (
        <Card>
          <CardHeader title="Points d'attention" />
          <ul className="divide-y divide-slate-100">
            {data.attention.map((d) => (
              <li key={d.id}>
                <Link href={`/app/documents/${d.id}`} className="flex items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                  <Icon name="alert" className={`h-5 w-5 shrink-0 ${d.suspicious ? "text-red-600" : "text-amber-600"}`} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{d.title || d.originalName}</span>
                  <span className="shrink-0 text-slate-500">
                    {d.suspicious ? "Document suspect : vérifiez-le" : d.status === "failed" ? "Analyse échouée" : "Pas encore analysé"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader
            title="Prochaines échéances"
            action={
              <Link href="/app/echeances" className="text-sm font-semibold text-brand-700">
                Tout voir
              </Link>
            }
          />
          <TaskList tasks={data.todo.slice(0, 6)} emptyText="Aucune échéance à venir. Les dates limites détectées dans vos documents apparaîtront ici." />
        </Card>
        <Card>
          <CardHeader
            title="Documents récents"
            action={
              <Link href="/app/documents" className="text-sm font-semibold text-brand-700">
                Tout voir
              </Link>
            }
          />
          {data.recent.items.length === 0 ? (
            <EmptyState icon="document" title="Aucun document pour l'instant">
              Ajoutez votre premier courrier ci-dessus : l&apos;analyse prend quelques secondes.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {data.recent.items.map((d) => (
                <DocumentRow key={d.id} doc={d} />
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
