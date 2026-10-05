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

export function ChangePasswordForm() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  if (done) return <p className="text-sm font-medium text-emerald-700">Mot de passe modifié. Vos autres appareils ont été déconnectés.</p>;
  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Changer mon mot de passe
      </Button>
    );
  }
  const field = "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("newPassword") !== f.get("confirm")) {
          setError("Les deux nouveaux mots de passe ne correspondent pas.");
          return;
        }
        setPending(true);
        setError(null);
        try {
          await apiFetch("/api/account/password", { method: "POST", json: { currentPassword: f.get("currentPassword"), newPassword: f.get("newPassword") } });
          setDone(true);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Modification impossible.");
        }
        setPending(false);
      }}
    >
      <label className="block text-sm font-medium text-slate-700">
        Mot de passe actuel
        <input name="currentPassword" type="password" required autoComplete="current-password" className={field} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Nouveau mot de passe
        <input name="newPassword" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={field} />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Confirmez le nouveau mot de passe
        <input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={field} />
      </label>
      {error && (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
