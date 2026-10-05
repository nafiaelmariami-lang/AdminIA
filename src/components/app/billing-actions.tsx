"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";

/** Boutons de souscription (Stripe Checkout). La formule n'est activée qu'après confirmation par Stripe. */
export function SubscribeButtons({ plan, featured, hasYearly }: { plan: "essentiel" | "pro"; featured: boolean; hasYearly: boolean }) {
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const go = async (interval: "month" | "year") => {
    setPending(interval);
    setError(null);
    try {
      const { url } = await apiFetch<{ url: string }>("/api/billing/checkout", { method: "POST", json: { plan, interval } });
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Paiement indisponible.");
      setPending(null);
    }
  };
  return (
    <div className="mt-6 space-y-2">
      <Button variant={featured ? "primary" : "secondary"} className="w-full" disabled={!!pending} onClick={() => go("month")}>
        {pending === "month" ? "Redirection…" : "Choisir — paiement mensuel"}
      </Button>
      {hasYearly && (
        <Button variant="ghost" className="w-full" disabled={!!pending} onClick={() => go("year")}>
          {pending === "year" ? "Redirection…" : "Paiement annuel (2 mois offerts)"}
        </Button>
      )}
      {error && <p className="text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function ManageSubscriptionButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <Button
        variant="secondary"
        disabled={pending}
        onClick={async () => {
          setPending(true);
          try {
            const { url } = await apiFetch<{ url: string }>("/api/billing/portal", { method: "POST" });
            window.location.assign(url);
          } catch (err) {
            setError(err instanceof Error ? err.message : "Portail indisponible.");
            setPending(false);
          }
        }}
      >
        {pending ? "Redirection…" : "Gérer mon abonnement et mes factures"}
      </Button>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}
