"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";

export function DeleteAccountForm() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!open) {
    return (
      <Button variant="secondary" className="text-red-700" onClick={() => setOpen(true)}>
        Supprimer mon compte…
      </Button>
    );
  }
  const field = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-200";
  return (
    <form
      className="space-y-3 rounded-xl border border-red-200 bg-red-50 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        try {
          await apiFetch("/api/account", { method: "DELETE", json: { password: f.get("password"), confirm: f.get("confirm") } });
          router.replace("/");
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Suppression impossible.");
          setPending(false);
        }
      }}
    >
      <p className="text-sm text-red-900">
        <strong>Action définitive.</strong> Tous vos documents, analyses, échéances et votre historique seront effacés. Pensez à exporter vos données avant.
      </p>
      <label className="block text-sm font-medium text-slate-800">
        Votre mot de passe
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Tapez SUPPRIMER pour confirmer
        <input name="confirm" required pattern="SUPPRIMER" autoComplete="off" className={field} />
      </label>
      {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button type="submit" variant="danger" disabled={pending}>
          {pending ? "Suppression…" : "Supprimer définitivement"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
