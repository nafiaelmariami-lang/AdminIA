import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/server/db";
import { requirePageUser } from "@/server/auth/current-user";
import { adminAccess } from "@/server/admin/access";
import { getAdminOverview, listAudit, listUsers } from "@/server/admin/service";
import { getPlan } from "@/lib/plans";
import { formatBytes, formatDate, formatDateTime } from "@/lib/format";
import { Alert, ButtonLink, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { PlanSelect, SettingToggle, VerifyEmailButton } from "@/components/admin/admin-controls";

export const metadata: Metadata = { title: "Administration", robots: { index: false, follow: false } };

const usd = (v: number) => `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`;
const AUDIT_LABELS: Record<string, string> = {
  "user.plan_changed": "Formule modifiée",
  "setting.changed": "Interrupteur modifié",
  "user.email_verified": "Adresse confirmée manuellement",
};
const SETTING_NAMES: Record<string, string> = { ai_analysis_enabled: "Analyses IA", uploads_enabled: "Ajout de documents", registrations_enabled: "Inscriptions" };

function auditDetails(action: string, d: Record<string, string | number | boolean | null> | null): string {
  if (!d) return "";
  if (action === "user.plan_changed") return `${getPlan(String(d.from)).label} → ${getPlan(String(d.to)).label}${d.reason ? ` (${String(d.reason)})` : ""}`;
  if (action === "setting.changed") return `${SETTING_NAMES[String(d.key)] ?? String(d.key)} : ${d.value ? "activé" : "coupé"}`;
  return Object.entries(d).filter(([, v]) => v !== null).map(([k, v]) => `${k} : ${String(v)}`).join(" · ");
}

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <p className="text-sm text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ q?: string; page?: string }> }) {
  const user = await requirePageUser();
  const db = await getDb();
  const access = await adminAccess(db, user);
  // Un non-administrateur ne doit même pas savoir que cette page existe.
  if (access === "none") notFound();
  if (access !== "admin") {
    return (
      <div className="space-y-6">
        <PageHeader title="Administration" />
        <Alert tone="warning" title="Accès protégé">
          {access === "needs_verification"
            ? "Confirmez d'abord votre adresse e-mail."
            : "Par sécurité, l'administration exige la double authentification. Activez-la depuis votre compte, puis revenez ici."}
        </Alert>
        <ButtonLink href="/app/compte" icon="shield">
          Aller à Mon compte
        </ButtonLink>
      </div>
    );
  }

  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.slice(0, 254) : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const [o, list, auditEntries] = await Promise.all([getAdminOverview(db), listUsers(db, { q, page }), listAudit(db, 20)]);
  const budgetPct = Math.min(100, Math.round((o.ai.spentTodayUsd / Math.max(0.01, o.ai.dailyBudgetUsd)) * 100));
  const pageHref = (p: number) => `/app/admin?${new URLSearchParams({ ...(q ? { q } : {}), page: String(p) }).toString()}#utilisateurs`;

  return (
    <div className="space-y-6">
      <PageHeader title="Administration" description="Statistiques agrégées et réglages. Le contenu des documents n'est jamais accessible ici." />

      {o.platform.emailDriver === "disabled" && (
        <Alert tone="warning" title="Envoi d'e-mails désactivé">
          Aucun lien de confirmation, de réinitialisation ni de rappel n&apos;est envoyé.
          {o.platform.emailVerificationRequired
            ? ` ${o.users.total - o.users.verified} compte(s) attendent une confirmation d'adresse : confirmez-la ci-dessous (« Confirmer l'adresse ») seulement pour les testeurs que vous connaissez, afin d'activer leur analyse.`
            : ""}
        </Alert>
      )}
      {o.platform.demoMode && <Alert tone="info">Mode démonstration : aucune IA réelle n&apos;est appelée, les coûts sont nuls.</Alert>}
      {!o.platform.aiEnabledByEnv && <Alert tone="warning">L&apos;IA est coupée par la variable d&apos;environnement AI_ENABLED.</Alert>}

      <section aria-label="Utilisateurs et documents" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Comptes" value={o.users.total} hint={`${o.users.new7d} nouveaux sur 7 jours`} />
        <Stat label="Actifs (7 jours)" value={o.users.active7d} hint={`${o.users.verified} adresses confirmées`} />
        <Stat label="Formules" value={`${o.users.byPlan.essentiel + o.users.byPlan.pro} payantes`} hint={`Découverte ${o.users.byPlan.free} · Essentiel ${o.users.byPlan.essentiel} · Pro ${o.users.byPlan.pro}`} />
        <Stat label="Double authentification" value={o.users.mfa} hint="comptes protégés" />
        <Stat label="Documents" value={o.documents.total} hint={`${o.documents.last24h} ajoutés sur 24 h · ${formatBytes(o.documents.bytes)}`} />
        <Stat label="Analysés" value={o.documents.analyzed} hint={`${o.documents.failed} en échec · ${o.documents.processing} en cours`} />
        <Stat label="Appels IA (24 h)" value={o.ai.last24h.calls} hint={`${o.ai.last24h.success} réussis · ${o.ai.last24h.failed} échecs · ${(o.ai.last24h.avgMs / 1000).toFixed(1)} s en moyenne`} />
        <Stat label="Coût IA du mois" value={usd(o.ai.month.costUsd)} hint={`${o.ai.month.calls} appels · ${(o.ai.month.inputTokens / 1000).toFixed(0)} k jetons en entrée`} />
      </section>

      <div className="grid gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <Card>
          <CardHeader title="Interrupteurs" subtitle="Effet immédiat sur toutes les instances." />
          <div className="divide-y divide-slate-100 px-5 py-2">
            {Object.entries(o.settings).map(([key, value]) => (
              <SettingToggle key={key} settingKey={key} value={value} />
            ))}
          </div>
        </Card>
        <Card>
          <CardHeader title="Budget IA du jour" subtitle={`Plafond global : ${usd(o.ai.dailyBudgetUsd)} (AI_DAILY_BUDGET_USD)`} />
          <div className="space-y-4 px-5 py-4">
            <div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-700">Dépensé aujourd&apos;hui (UTC)</span>
                <span className="font-medium text-slate-900">
                  {usd(o.ai.spentTodayUsd)} ({budgetPct} %)
                </span>
              </div>
              <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={budgetPct} aria-valuemin={0} aria-valuemax={100} aria-label="Budget IA du jour">
                <div className={`h-full rounded-full ${budgetPct >= 90 ? "bg-red-500" : budgetPct >= 70 ? "bg-orange-500" : "bg-brand-600"}`} style={{ width: `${budgetPct}%` }} />
              </div>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">Erreurs IA sur 7 jours</p>
              {o.ai.errors7d.length === 0 ? (
                <p className="text-sm text-slate-500">Aucune.</p>
              ) : (
                <ul className="mt-1 text-sm text-slate-700">
                  {o.ai.errors7d.map((e) => (
                    <li key={e.code} className="flex justify-between">
                      <code>{e.code}</code>
                      <span>{e.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-slate-500">IA</dt>
              <dd className="text-slate-900">
                {o.platform.aiProvider} · {o.platform.aiModel}
              </dd>
              <dt className="text-slate-500">E-mails</dt>
              <dd className="text-slate-900">{o.platform.emailDriver}</dd>
              <dt className="text-slate-500">Stockage</dt>
              <dd className="text-slate-900">{o.platform.storageDriver}</dd>
              <dt className="text-slate-500">Paiement</dt>
              <dd className="text-slate-900">{o.platform.billingEnabled ? "Stripe activé" : "désactivé"}</dd>
            </dl>
          </div>
        </Card>
      </div>

      <Card>
        <div id="utilisateurs" />
        <CardHeader title={`Utilisateurs (${list.total})`} subtitle="Formule attribuée à la main pour les testeurs de la bêta ; visible dans leur historique." />
        <form method="get" action="/app/admin#utilisateurs" className="flex gap-2 px-5 pt-4" role="search">
          <input name="q" defaultValue={q} placeholder="Rechercher une adresse ou un nom" aria-label="Rechercher un utilisateur" className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-base" />
          <button type="submit" className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Rechercher
          </button>
        </form>
        <div className="overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2 pr-3 font-semibold">Compte</th>
                <th className="py-2 pr-3 font-semibold">Formule</th>
                <th className="py-2 pr-3 font-semibold">Docs</th>
                <th className="py-2 pr-3 font-semibold">Analyses (mois)</th>
                <th className="py-2 pr-3 font-semibold">Sécurité</th>
                <th className="py-2 pr-3 font-semibold">Inscrit</th>
                <th className="py-2 font-semibold">Dernière connexion</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {list.users.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-3">
                    <p className="font-medium text-slate-900 [overflow-wrap:anywhere]">{u.email}</p>
                    <p className="text-xs text-slate-500">{u.name}</p>
                  </td>
                  <td className="py-2 pr-3">
                    <PlanSelect userId={u.id} email={u.email} plan={u.plan} locked={!!u.subscriptionStatus && ["active", "trialing", "past_due", "incomplete"].includes(u.subscriptionStatus)} />
                  </td>
                  <td className="py-2 pr-3 text-slate-700">
                    {u.documents} <span className="text-xs text-slate-500">({formatBytes(u.storageBytes)})</span>
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{u.analysesThisMonth}</td>
                  <td className="py-2 pr-3 text-xs">
                    <span className={u.emailVerified ? "text-emerald-700" : "text-amber-700"}>{u.emailVerified ? "E-mail confirmé" : "Non confirmé"}</span>
                    {!u.emailVerified && <VerifyEmailButton userId={u.id} email={u.email} />}
                    {u.mfaEnabled && <span className="block text-emerald-700">2FA</span>}
                  </td>
                  <td className="py-2 pr-3 text-slate-700">{formatDate(u.createdAt, { day: "numeric", month: "short", year: "numeric" })}</td>
                  <td className="py-2 text-slate-700">{u.lastLoginAt ? formatDate(u.lastLoginAt, { day: "numeric", month: "short", year: "numeric" }) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.users.length === 0 && <p className="py-4 text-sm text-slate-500">Aucun compte trouvé.</p>}
          <div className="mt-3 flex justify-between text-sm">
            {list.page > 1 ? <Link href={pageHref(list.page - 1)} className="font-medium text-brand-700">← Précédents</Link> : <span />}
            {list.hasMore && <Link href={pageHref(list.page + 1)} className="font-medium text-brand-700">Suivants →</Link>}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Journal d'administration" subtitle="20 dernières actions" />
        <div className="px-5 py-4">
          {auditEntries.length === 0 ? (
            <p className="text-sm text-slate-500">Aucune action pour l&apos;instant.</p>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {auditEntries.map((a) => (
                <li key={a.id} className="py-2">
                  <span className="font-medium text-slate-900">{AUDIT_LABELS[a.action] ?? a.action}</span>{" "}
                  <span className="text-slate-600">
                    {auditDetails(a.action, a.details)}
                    {a.targetEmail ? ` · ${a.targetEmail}` : ""}
                  </span>
                  <span className="block text-xs text-slate-500">
                    {formatDateTime(a.createdAt)} — {a.adminEmail}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
