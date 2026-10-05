import Link from "next/link";
import { Icon, type IconName } from "@/components/ui/icon";
import { buttonClass, UrgencyBadge } from "@/components/ui/primitives";
import { PricingGrid } from "@/components/site/pricing";

const STEPS: { icon: IconName; title: string; text: string }[] = [
  { icon: "camera", title: "Photographiez ou déposez", text: "Un courrier papier, un PDF reçu par e-mail, une facture : en un geste, depuis votre téléphone ou votre ordinateur." },
  { icon: "sparkles", title: "AdminIA vous l'explique", text: "En quelques secondes : de quoi il s'agit, qui vous écrit, ce que vous devez faire, pour quand et combien." },
  { icon: "calendar", title: "Vous ne ratez plus rien", text: "Les échéances sont ajoutées à votre tableau de bord et peuvent rejoindre votre agenda, avec rappel la veille." },
];

const FAQ = [
  {
    q: "Quels documents puis-je envoyer ?",
    a: "Courriers Urssaf, impôts (CFE, avis d'imposition), CAF, assurances, banques, factures, devis, contrats… au format PDF, Word, JPEG, PNG ou WEBP.",
  },
  {
    q: "Mes documents sont-ils en sécurité ?",
    a: "Vos fichiers sont chiffrés, isolés de ceux des autres utilisateurs et ne servent jamais à entraîner une IA. Vous pouvez tout exporter ou tout supprimer à tout moment, en un clic.",
  },
  {
    q: "AdminIA remplace-t-il mon expert-comptable ?",
    a: "Non. AdminIA vous aide à comprendre et à organiser vos documents. Pour un conseil juridique ou fiscal personnalisé, adressez-vous à un professionnel.",
  },
  {
    q: "L'IA peut-elle se tromper ?",
    a: "Oui, c'est possible. Chaque fiche renvoie au document original et toutes les informations (dates, montants, échéances) sont modifiables. Vérifiez toujours les éléments importants.",
  },
  {
    q: "Puis-je arrêter quand je veux ?",
    a: "Oui. La formule Découverte est gratuite et sans carte bancaire. Les formules payantes seront sans engagement.",
  },
];

export default function HomePage() {
  return (
    <>
      {/* Accroche */}
      <section className="relative overflow-hidden bg-gradient-to-b from-brand-50 to-white">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-sm font-medium text-brand-700 ring-1 ring-brand-200">
              <Icon name="shield" className="h-4 w-4" /> Pour indépendants, artisans et TPE
            </p>
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
              Vos courriers administratifs, <span className="text-brand-600">enfin compris.</span>
            </h1>
            <p className="mt-6 text-lg leading-relaxed text-slate-600">
              Photographiez un courrier Urssaf, un avis d&apos;impôt ou une facture. AdminIA vous dit <strong>ce que c&apos;est</strong>,{" "}
              <strong>ce que vous devez faire</strong> et <strong>pour quand</strong> — puis vous rappelle l&apos;échéance.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/inscription" className={buttonClass("primary", "px-6 py-3 text-base")}>
                Essayer gratuitement <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
              <Link href="/tarifs" className={buttonClass("secondary", "px-6 py-3 text-base")}>
                Voir les tarifs
              </Link>
            </div>
            <p className="mt-4 text-sm text-slate-500">5 analyses offertes chaque mois · Sans carte bancaire · Données hébergées de façon sécurisée</p>
          </div>

          {/* Exemple de fiche */}
          <div className="relative">
            <div className="absolute -inset-4 -z-0 rounded-3xl bg-brand-200/40 blur-2xl" aria-hidden="true" />
            <div className="relative rounded-2xl border border-slate-200 bg-white p-6 shadow-xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Urssaf · Appel de cotisations</p>
                  <p className="mt-1 text-lg font-semibold text-slate-900">Cotisations du 3e trimestre</p>
                </div>
                <UrgencyBadge level="eleve" />
              </div>
              <p className="mt-4 text-sm leading-relaxed text-slate-700">
                L&apos;Urssaf vous demande de payer vos cotisations sociales du 3e trimestre. Sans paiement à temps, une pénalité de retard (majoration) sera ajoutée.
              </p>
              <dl className="mt-5 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3">
                  <dt className="text-slate-500">Combien ?</dt>
                  <dd className="mt-1 text-lg font-bold text-slate-900">1 234,56 €</dd>
                </div>
                <div className="rounded-xl bg-orange-50 p-3">
                  <dt className="text-orange-800">Pour quand ?</dt>
                  <dd className="mt-1 text-lg font-bold text-orange-900">15 nov. 2026</dd>
                </div>
              </dl>
              <div className="mt-5">
                <p className="text-sm font-semibold text-slate-900">À faire</p>
                <ul className="mt-2 space-y-2 text-sm">
                  <li className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2">
                    <span className="h-4 w-4 rounded border border-slate-300" /> Payer 1 234,56 € sur votre espace urssaf.fr
                  </li>
                  <li className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-slate-500">
                    <span className="h-4 w-4 rounded border border-slate-300" /> Conserver le justificatif de paiement
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Comment ça marche */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Simple comme une photo</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">Pas de formulaire, pas de jargon, pas de formation. Si vous savez prendre une photo, vous savez utiliser AdminIA.</p>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <div key={s.title} className="rounded-2xl border border-slate-200 p-6">
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
                  <Icon name={s.icon} />
                </span>
                <span className="text-sm font-semibold text-brand-700">Étape {i + 1}</span>
              </div>
              <h3 className="mt-4 text-lg font-semibold text-slate-900">{s.title}</h3>
              <p className="mt-2 text-slate-600">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bénéfices */}
      <section className="bg-slate-50">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold tracking-tight text-slate-900">Fini les majorations pour un courrier oublié</h2>
            <p className="mt-4 text-slate-600">
              Une seule pénalité de retard Urssaf ou une CFE payée en retard coûte souvent plus cher qu&apos;un an d&apos;abonnement. AdminIA transforme chaque courrier en
              actions claires et datées.
            </p>
            <ul className="mt-6 space-y-3 text-slate-700">
              {[
                "Tableau de bord : ce qui est urgent, ce qui arrive, ce qui est fait",
                "Classement automatique : Urssaf, impôts, assurances, fournisseurs…",
                "Recherche instantanée dans tous vos documents",
                "Échéances dans votre agenda (Google, Outlook, Apple)",
              ].map((t) => (
                <li key={t} className="flex gap-2">
                  <Icon name="check" className="h-5 w-5 shrink-0 text-brand-600" /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-6">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                <Icon name="lock" />
              </span>
              <h3 className="text-lg font-semibold text-slate-900">Vos données restent les vôtres</h3>
            </div>
            <ul className="mt-5 space-y-3 text-sm text-slate-700">
              <li><strong>Chiffrement</strong> de chaque fichier stocké.</li>
              <li><strong>Isolation stricte</strong> : personne d&apos;autre ne peut voir vos documents.</li>
              <li><strong>Aucun entraînement</strong> d&apos;IA sur vos documents.</li>
              <li><strong>Export complet</strong> et <strong>suppression définitive</strong> en un clic (RGPD).</li>
              <li><strong>Protection anti-fraude</strong> : AdminIA signale les documents suspects (faux courriers, hameçonnage).</li>
            </ul>
          </div>
        </div>
      </section>

      {/* Tarifs */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" id="tarifs">
        <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Des tarifs simples</h2>
        <p className="mx-auto mt-3 max-w-2xl text-center text-slate-600">Commencez gratuitement. Passez à une formule payante quand AdminIA vous a fait gagner du temps.</p>
        <div className="mt-12">
          <PricingGrid />
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-slate-50">
        <div className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
          <h2 className="text-center text-3xl font-bold tracking-tight text-slate-900">Questions fréquentes</h2>
          <div className="mt-10 space-y-3">
            {FAQ.map((f) => (
              <details key={f.q} className="group rounded-xl border border-slate-200 bg-white p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between font-semibold text-slate-900">
                  {f.q}
                  <Icon name="plus" className="h-5 w-5 shrink-0 text-slate-400 transition-transform group-open:rotate-45" />
                </summary>
                <p className="mt-3 text-slate-600">{f.a}</p>
              </details>
            ))}
          </div>
          <div className="mt-12 text-center">
            <Link href="/inscription" className={buttonClass("primary", "px-6 py-3 text-base")}>
              Créer mon compte gratuit
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
