"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

export function VerifyEmailBanner({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "pending" | "sent" | "error">("idle");
  const [error, setError] = useState("");
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
