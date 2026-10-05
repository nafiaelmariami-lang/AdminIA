import type { Metadata } from "next";
import { getDb } from "@/server/db";
import { requirePageUser } from "@/server/auth/current-user";
import { getAccountSummary } from "@/server/account/service";
import { formatBytes, formatDate } from "@/lib/format";
import { ButtonLink, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { PricingGrid } from "@/components/site/pricing";
import { ChangePasswordForm, DeleteAccountForm } from "@/components/app/account-actions";

export const metadata: Metadata = { title: "Mon compte" };

function Meter({ label, used, limit, suffix }: { label: string; used: number; limit: number; suffix?: string }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-600">
          {used} / {limit} {suffix}
        </span>
      </div>
      <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full ${pct >= 90 ? "bg-red-500" : pct >= 70 ? "bg-orange-500" : "bg-brand-600"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default async function AccountPage() {
  const user = await requirePageUser();
  const { user: account, plan, usage } = await getAccountSummary(await getDb(), user.id);
  return (
    <div className="space-y-6">
      <PageHeader title="Mon compte" />

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Profil" />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 px-5 py-4 text-sm">
            <dt className="text-slate-500">Nom</dt>
            <dd className="text-slate-900">{account.name}</dd>
            <dt className="text-slate-500">E-mail</dt>
            <dd className="break-all text-slate-900">
              {account.email}{" "}
              {account.emailVerifiedAt ? (
                <span className="ml-1 whitespace-nowrap rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Confirmée</span>
              ) : (
                <span className="ml-1 whitespace-nowrap rounded-md bg-amber-50 px-1.5 py-0.5 text-xs font-semibold text-amber-800">À confirmer</span>
              )}
            </dd>
            <dt className="text-slate-500">Membre depuis</dt>
            <dd className="text-slate-900">{formatDate(account.createdAt)}</dd>
          </dl>
          <div className="border-t border-slate-100 px-5 py-4">
            <ChangePasswordForm />
          </div>
        </Card>
        <Card>
          <CardHeader title={`Formule ${plan.label}`} subtitle="Consommation du mois en cours (remise à zéro le 1er du mois)" />
          <div className="space-y-5 px-5 py-4">
            <Meter label="Analyses IA" used={usage.analysesUsed} limit={usage.analysesLimit} />
            <Meter label="Documents stockés" used={usage.documents} limit={usage.documentsLimit} />
            <p className="text-sm text-slate-500">Espace utilisé : {formatBytes(usage.storageBytes)}</p>
          </div>
        </Card>
      </div>

      <section>
        <h2 className="mb-4 text-lg font-semibold text-slate-900">Changer de formule</h2>
        <PricingGrid currentPlan={account.plan} />
      </section>

      <Card>
        <CardHeader title="Vos données" subtitle="Vous gardez le contrôle total de vos informations (RGPD)." />
        <div className="grid gap-6 px-5 py-5 md:grid-cols-2">
          <div>
            <h3 className="font-semibold text-slate-900">Exporter mes données</h3>
            <p className="mt-1 text-sm text-slate-600">Une archive ZIP avec tous vos documents originaux, leurs analyses, vos échéances et votre historique.</p>
            <div className="mt-3">
              <ButtonLink href="/api/account/export" variant="secondary" icon="download" download>
                Télécharger l&apos;export
              </ButtonLink>
            </div>
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Supprimer mon compte</h3>
            <p className="mt-1 mb-3 text-sm text-slate-600">Effacement définitif et immédiat de toutes vos données et de vos fichiers.</p>
            <DeleteAccountForm />
          </div>
        </div>
      </Card>
    </div>
  );
}
