"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export function VerifyEmailBanner({ email, devOutbox = null, emailEnabled = true }: { email: string; devOutbox?: string | null; emailEnabled?: boolean }) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  if (devOutbox) return <DevVerifyBanner outboxDir={devOutbox} />;
  if (!emailEnabled) {
    // Bêta sans e-mail : aucun lien n'a été envoyé, ne pas prétendre le contraire.
    return (
      <div role="status" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <strong>Adresse e-mail à confirmer par l&apos;équipe AdminIA.</strong> Pendant la bêta, l&apos;envoi d&apos;e-mails n&apos;est pas encore activé : aucun
        lien ne vous a été envoyé. L&apos;équipe confirmera l&apos;adresse <span className="break-all font-medium">{email}</span> ; l&apos;analyse de vos documents
        sera alors disponible. Vous pouvez déjà ajouter vos documents.
      </div>
    );
  }
  return (
    <div role="status" className="mb-6 flex flex-col gap-3 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900 sm:flex-row sm:items-center sm:justify-between">
      <p className="min-w-0">
        <strong>Confirmez votre adresse e-mail</strong> pour activer l&apos;analyse de vos documents. Un lien a été envoyé à{" "}
        <span className="break-all font-medium">{email}</span>.
      </p>
      <div className="shrink-0">
        {state === "sent" ? (
          <span className="font-semibold">Nouveau lien envoyé.</span>
        ) : (
          <button
            type="button"
            disabled={state === "pending"}
            onClick={async () => {
              setState("pending");
              try {
                await apiFetch("/api/auth/verify-email/resend", { method: "POST" });
                setState("sent");
              } catch (err) {
                setError(err instanceof Error ? err.message : "Envoi impossible.");
                setState("error");
              }
            }}
            className="rounded-lg bg-white px-3 py-2 font-semibold text-brand-700 ring-1 ring-brand-200 hover:bg-brand-100 disabled:opacity-60"
          >
            {state === "pending" ? "Envoi…" : "Renvoyer le lien"}
          </button>
        )}
        {state === "error" && <p className="mt-1 text-red-700">{error}</p>}
      </div>
    </div>
  );
}

/** Développement : aucun e-mail réel n'est envoyé ; confirmation directe depuis la boîte d'envoi locale. */
function DevVerifyBanner({ outboxDir }: { outboxDir: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <div role="status" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <p>
        <strong>Mode développement : aucun e-mail n&apos;est réellement envoyé.</strong> Le message de confirmation a été enregistré dans{" "}
        <code className="break-all rounded bg-amber-100 px-1">{outboxDir}</code>. Confirmez votre adresse pour activer l&apos;analyse :
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError("");
            try {
              const { link } = await apiFetch<{ link: string }>("/api/dev/verification-link");
              window.location.assign(link);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Lien introuvable.");
              setPending(false);
            }
          }}
          className="rounded-lg bg-amber-600 px-3 py-2 font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {pending ? "Ouverture…" : "Confirmer mon adresse (développement)"}
        </button>
        {error && <span className="text-red-700">{error}</span>}
      </div>
    </div>
  );
}
