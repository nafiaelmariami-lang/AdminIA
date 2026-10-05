"use client";

import Link from "next/link";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Alert, Button } from "@/components/ui/primitives";

/** Confirmation par un clic (et non à l'ouverture du lien) : les antivirus de messagerie ouvrent les liens. */
export function UnsubscribeForm({ u, t }: { u: string; t: string }) {
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  const [error, setError] = useState("");
  if (state === "done") {
    return (
      <Alert tone="success" title="C'est fait">
        Les rappels sont désactivés. Vous pouvez les réactiver à tout moment depuis{" "}
        <Link href="/app/compte" className="font-semibold underline">
          votre compte
        </Link>
        .
      </Alert>
    );
  }
  return (
    <div className="space-y-3">
      {state === "error" && <Alert tone="danger">{error}</Alert>}
      <Button
        className="w-full py-3"
        disabled={state === "pending"}
        onClick={async () => {
          setState("pending");
          try {
            await apiFetch("/api/notifications/unsubscribe", { method: "POST", json: { u, t } });
            setState("done");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Lien invalide.");
            setState("error");
          }
        }}
      >
        Confirmer le désabonnement
      </Button>
    </div>
  );
}
