import Link from "next/link";
import { PLANS } from "@/lib/plans";
import { Icon } from "@/components/ui/icon";
import { buttonClass } from "@/components/ui/primitives";
import { SubscribeButtons } from "@/components/app/billing-actions";

const price = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export function PricingGrid({
  currentPlan,
  ctaHref = "/inscription",
  billing,
}: {
  currentPlan?: string;
  ctaHref?: string;
  /** Dans l'espace connecté : paiement en ligne configuré ou non. */
  billing?: { enabled: boolean; hasYearly: boolean };
}) {
  return (
    <div className="grid gap-6 md:grid-cols-3">
      {Object.values(PLANS).map((plan) => {
        const featured = plan.id === "essentiel";
        const current = currentPlan === plan.id;
        return (
          <div key={plan.id} className={`relative flex flex-col rounded-2xl border bg-white p-6 shadow-sm ${featured ? "border-brand-500 ring-2 ring-brand-500" : "border-slate-200"}`}>
            {featured && <span className="absolute -top-3 left-6 rounded-full bg-brand-600 px-3 py-1 text-xs font-semibold text-white">Le plus choisi</span>}
            <h3 className="text-lg font-semibold text-slate-900">{plan.label}</h3>
            <p className="mt-4 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-tight text-slate-900">{price(plan.priceMonthlyEurHt)} €</span>
              <span className="text-sm text-slate-500">{plan.priceMonthlyEurHt ? "HT / mois" : "pour toujours"}</span>
            </p>
            {plan.priceYearlyEurHt > 0 && <p className="mt-1 text-sm text-slate-500">ou {price(plan.priceYearlyEurHt)} € HT / an (2 mois offerts)</p>}
            <ul className="mt-6 flex-1 space-y-3 text-sm text-slate-700">
              {plan.highlights.map((h) => (
                <li key={h} className="flex gap-2">
                  <Icon name="check" className="h-5 w-5 shrink-0 text-brand-600" />
                  {h}
                </li>
              ))}
            </ul>
            {current ? (
              <p className="mt-6 rounded-lg bg-slate-100 py-2.5 text-center text-sm font-semibold text-slate-700">Votre formule actuelle</p>
            ) : !currentPlan ? (
              <Link href={ctaHref} className={buttonClass(featured ? "primary" : "secondary", "mt-6 w-full")}>
                {plan.id === "free" ? "Commencer gratuitement" : `Choisir ${plan.label}`}
              </Link>
            ) : plan.id === "free" || currentPlan !== "free" ? (
              // Abonné : changement ou résiliation via le portail (évite un second abonnement).
              <p className="mt-6 rounded-lg border border-dashed border-slate-300 px-3 py-2.5 text-center text-sm text-slate-500">
                {billing?.enabled ? "Changement via « Gérer mon abonnement »" : "Changement de formule bientôt disponible"}
              </p>
            ) : billing?.enabled ? (
              <SubscribeButtons plan={plan.id} featured={featured} hasYearly={billing.hasYearly} />
            ) : (
              <p className="mt-6 rounded-lg border border-dashed border-slate-300 py-2.5 text-center text-sm text-slate-500">Paiement en ligne bientôt disponible</p>
            )}
          </div>
        );
      })}
    </div>
  );
}
