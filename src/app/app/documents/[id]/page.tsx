import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePageUser } from "@/server/auth/current-user";
import { getOwnedDocument } from "@/server/documents/service";
import { listTasks } from "@/server/tasks/service";
import { AppError } from "@/server/errors";
import { getConfig } from "@/server/config";
import { formatAmount, formatBytes, formatDate, formatDateTime, relativeDue } from "@/lib/format";
import { DOC_TYPE_LABELS, STATUS_LABELS } from "@/lib/labels";
import { Alert, ButtonLink, Card, CardHeader, CategoryBadge, UrgencyBadge } from "@/components/ui/primitives";
import { Icon, type IconName } from "@/components/ui/icon";
import { AddTaskForm, TaskList } from "@/components/app/task-list";
import { AnalyzeButton, DeleteDocumentButton, EditDocumentForm } from "@/components/app/document-actions";

export const metadata: Metadata = { title: "Document" };

function KeyFact({ icon, question, answer, detail, tone = "default" }: { icon: IconName; question: string; answer: string; detail?: string | null; tone?: "default" | "warning" | "danger" }) {
  const tones = { default: "bg-white", warning: "bg-orange-50 border-orange-200", danger: "bg-red-50 border-red-200" };
  return (
    <div className={`rounded-2xl border border-slate-200 p-4 ${tones[tone]}`}>
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
        <Icon name={icon} className="h-4 w-4" /> {question}
      </p>
      <p className="mt-2 text-lg font-bold leading-snug text-slate-900">{answer}</p>
      {detail && <p className="mt-1 text-sm text-slate-600">{detail}</p>}
    </div>
  );
}

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePageUser();
  const { id } = await params;
  const db = await getDb();
  const doc = await getOwnedDocument(db, user.id, id).catch((err) => {
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  });
  const tasks = await listTasks(db, user.id, { status: "all", documentId: doc.id });
  const a = doc.analysis;
  const nextDeadline = a?.echeances.slice().sort((x, y) => x.date.localeCompare(y.date)).find((e) => relativeDue(e.date).tone !== "late") ?? a?.echeances[0];
  const due = nextDeadline ? relativeDue(nextDeadline.date) : null;
  const isProcessing = doc.status === "processing";
  const mustVerify = getConfig().EMAIL_VERIFICATION_REQUIRED && !user.emailVerifiedAt;

  return (
    <div className="space-y-6">
      <Link href="/app/documents" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-900">
        ← Tous les documents
      </Link>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <CategoryBadge category={doc.category} />
            <UrgencyBadge level={doc.urgency} />
            {doc.status !== "analyzed" && <span className="text-sm text-slate-500">{STATUS_LABELS[doc.status]}</span>}
          </div>
          <h1 className="mt-2 break-words text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{doc.title || doc.originalName}</h1>
          {a && <p className="mt-1 text-slate-600">{[a.organisme, DOC_TYPE_LABELS[a.type_document], a.date_document ? `du ${formatDate(a.date_document)}` : null].filter(Boolean).join(" · ")}</p>}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <ButtonLink href={`/api/documents/${doc.id}/file`} variant="secondary" icon="external">
            Voir l&apos;original
          </ButtonLink>
          <ButtonLink href={`/api/documents/${doc.id}/file?download=1`} variant="secondary" icon="download">
            Télécharger
          </ButtonLink>
          <DeleteDocumentButton documentId={doc.id} />
        </div>
      </div>

      {doc.suspicious && (
        <Alert tone="danger" title="Document à vérifier avant toute action">
          Ce document contient des éléments inhabituels (tentative de fraude ou instructions cachées).
          {a?.alertes_securite && a.alertes_securite.length > 0 && <> Signaux : {a.alertes_securite.join(", ").toLowerCase()}.</>} Ne payez rien et ne communiquez aucune information
          sans avoir vérifié auprès de l&apos;organisme, en utilisant ses coordonnées officielles (et non celles du document).
        </Alert>
      )}

      {!a && (
        <Card className="p-6">
          {isProcessing ? (
            <p className="flex items-center gap-3 text-slate-700">
              <span className="block h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" /> Analyse en cours… Rechargez la page dans quelques
              secondes.
            </p>
          ) : (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-semibold text-slate-900">{doc.status === "failed" ? "L'analyse n'a pas abouti" : "Ce document n'a pas encore été analysé"}</p>
                <p className="mt-1 text-sm text-slate-600">{doc.errorMessage ?? "L'analyse détecte le type de document, les montants, les échéances et les actions à mener."}</p>
              </div>
              {mustVerify ? (
                <p className="max-w-xs text-sm font-medium text-brand-800">Confirmez votre adresse e-mail (lien reçu à l&apos;inscription) pour lancer l&apos;analyse.</p>
              ) : (
                <AnalyzeButton documentId={doc.id} label={doc.status === "failed" ? "Réessayer l'analyse" : "Analyser ce document"} />
              )}
            </div>
          )}
        </Card>
      )}

      {a && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 [&>*]:min-w-0">
            <KeyFact icon="document" question="Qu'est-ce que c'est ?" answer={DOC_TYPE_LABELS[a.type_document] ?? "Document"} detail={a.reference ? `Réf. ${a.reference}` : null} />
            <KeyFact icon="building" question="Qui vous écrit ?" answer={a.organisme ?? "Non identifié"} detail={a.entreprise ? `Pour : ${a.entreprise}` : null} />
            <KeyFact
              icon="calendar"
              question="Pour quand ?"
              answer={nextDeadline ? formatDate(nextDeadline.date) : "Pas de date limite"}
              detail={nextDeadline ? `${due?.text} · ${nextDeadline.libelle}` : null}
              tone={due?.tone === "late" ? "danger" : due?.tone === "soon" ? "warning" : "default"}
            />
            <KeyFact icon="euro" question="Combien ?" answer={a.montant_a_payer !== null ? formatAmount(a.montant_a_payer) : "Rien à payer"} detail={a.montant_a_payer !== null ? "Montant à régler" : null} />
          </div>

          <Card>
            <CardHeader title="En résumé" subtitle={a.justification_urgence || undefined} />
            <p className="px-5 py-4 leading-relaxed text-slate-800">{a.resume}</p>
            {a.confiance === "faible" && (
              <div className="px-5 pb-4">
                <Alert tone="warning">Le document était difficile à lire : vérifiez attentivement les informations sur l&apos;original.</Alert>
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Que dois-je faire ?" subtitle={a.aucune_action_requise && tasks.length === 0 ? "Aucune action n'est demandée : ce document est à conserver." : undefined} />
            <TaskList tasks={tasks} showDocument={false} emptyText="Aucune action à faire." />
            <div className="border-t border-slate-100 px-5 py-3">
              <AddTaskForm documentId={doc.id} />
            </div>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
            {a.informations_importantes.length > 0 && (
              <Card>
                <CardHeader title="À savoir" />
                <ul className="space-y-2 px-5 py-4 text-sm text-slate-800">
                  {a.informations_importantes.map((i) => (
                    <li key={i} className="flex gap-2">
                      <Icon name="sparkles" className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" /> {i}
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            {a.montants.length > 0 && (
              <Card>
                <CardHeader title="Montants" />
                <dl className="divide-y divide-slate-100 text-sm">
                  {a.montants.map((m, i) => (
                    <div key={i} className="flex justify-between gap-4 px-5 py-2.5">
                      <dt className="text-slate-600">
                        {m.libelle}
                        {m.sens === "a_recevoir" && <span className="ml-2 text-xs font-semibold text-emerald-700">à recevoir</span>}
                      </dt>
                      <dd className="font-semibold text-slate-900">{formatAmount(m.montant, m.devise)}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            )}
            {(a.dates_importantes.length > 0 || a.echeances.length > 0) && (
              <Card>
                <CardHeader title="Dates" />
                <dl className="divide-y divide-slate-100 text-sm">
                  {[...a.echeances.map((e) => ({ date: e.date, libelle: e.libelle, deadline: true })), ...a.dates_importantes.map((d) => ({ ...d, deadline: false }))]
                    .sort((x, y) => x.date.localeCompare(y.date))
                    .map((d, i) => (
                      <div key={i} className="flex justify-between gap-4 px-5 py-2.5">
                        <dt className="text-slate-600">
                          {d.libelle}
                          {d.deadline && <span className="ml-2 text-xs font-semibold text-orange-700">échéance</span>}
                        </dt>
                        <dd className="shrink-0 font-semibold text-slate-900">{formatDate(d.date)}</dd>
                      </div>
                    ))}
                </dl>
              </Card>
            )}
            {a.personnes.length > 0 && (
              <Card>
                <CardHeader title="Personnes mentionnées" />
                <ul className="divide-y divide-slate-100 text-sm">
                  {a.personnes.map((p, i) => (
                    <li key={i} className="flex justify-between gap-4 px-5 py-2.5">
                      <span className="font-medium text-slate-900">{p.nom}</span>
                      <span className="text-slate-500">{p.role}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </div>
        </>
      )}

      <Card>
        <CardHeader title="Informations sur le fichier" />
        <div className="grid gap-6 px-5 py-4 lg:grid-cols-2">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Nom du fichier</dt>
            <dd className="break-all text-slate-900">{doc.originalName}</dd>
            <dt className="text-slate-500">Taille</dt>
            <dd className="text-slate-900">
              {formatBytes(doc.sizeBytes)}
              {doc.pageCount ? ` · ${doc.pageCount} page${doc.pageCount > 1 ? "s" : ""}` : ""}
            </dd>
            <dt className="text-slate-500">Ajouté le</dt>
            <dd className="text-slate-900">{formatDateTime(doc.createdAt)}</dd>
            {doc.analyzedAt && (
              <>
                <dt className="text-slate-500">Analysé le</dt>
                <dd className="text-slate-900">{formatDateTime(doc.analyzedAt)}</dd>
              </>
            )}
          </dl>
          <div className="space-y-4">
            <EditDocumentForm documentId={doc.id} title={doc.title ?? doc.originalName} category={doc.category} />
            {a && !isProcessing && !mustVerify && <AnalyzeButton documentId={doc.id} label="Relancer l'analyse" variant="secondary" />}
          </div>
        </div>
      </Card>

      <p className="text-center text-xs text-slate-500">
        Analyse automatique par intelligence artificielle : elle peut comporter des erreurs. Vérifiez les informations importantes sur le document original. AdminIA ne fournit pas de
        conseil juridique ou fiscal.
      </p>
    </div>
  );
}
