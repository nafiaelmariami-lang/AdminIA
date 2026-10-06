"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Button } from "@/components/ui/primitives";
import { Icon } from "@/components/ui/icon";

export function ReminderToggle({ initial, verified, emailEnabled = true }: { initial: boolean; verified: boolean; emailEnabled?: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 rounded border-slate-300"
          checked={on}
          disabled={pending}
          onChange={async (e) => {
            const next = e.target.checked;
            setPending(true);
            setError(null);
            try {
              await apiFetch("/api/account/notifications", { method: "PATCH", json: { reminderEmails: next } });
              setOn(next);
            } catch (err) {
              setError(err instanceof Error ? err.message : "Modification impossible.");
            }
            setPending(false);
          }}
        />
        <span className="text-sm">
          <span className="font-semibold text-slate-900">Rappels d&apos;échéances par e-mail</span>
          <span className="block text-slate-600">Une semaine avant, la veille, et en cas de retard. Un seul e-mail récapitulatif par jour au maximum.</span>
          {!emailEnabled ? (
            <span className="mt-1 block text-amber-800">L&apos;envoi d&apos;e-mails n&apos;est pas encore activé : aucun rappel ne part pour l&apos;instant. Votre choix sera appliqué dès son activation ; en attendant, utilisez l&apos;abonnement agenda.</span>
          ) : (
            !verified && <span className="mt-1 block text-amber-800">Confirmez votre adresse e-mail pour recevoir les rappels.</span>
          )}
        </span>
      </label>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
    </div>
  );
}

export function CalendarFeed({ enabled }: { enabled: boolean }) {
  const [active, setActive] = useState(enabled);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    setError(null);
    try {
      const r = await apiFetch<{ url: string }>("/api/calendar/token", { method: "POST" });
      setUrl(r.url);
      setActive(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création impossible.");
    }
  }

  return (
    <div className="text-sm">
      <p className="font-semibold text-slate-900">Synchronisation avec votre agenda</p>
      <p className="mt-1 text-slate-600">
        Abonnez Google Agenda, Outlook ou Calendrier Apple à vos échéances : elles s&apos;y mettent à jour automatiquement. Le lien est personnel, gardez-le secret.
      </p>
      {url && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <p className="text-xs font-semibold text-slate-700">Votre lien (affiché une seule fois) :</p>
          <p className="mt-1 break-all font-mono text-xs text-slate-800">{url}</p>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(url).catch(() => undefined);
              setCopied(true);
            }}
            className="mt-2 inline-flex items-center gap-1.5 font-semibold text-brand-700"
          >
            <Icon name="copy" className="h-4 w-4" /> {copied ? "Copié" : "Copier le lien"}
          </button>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" icon="calendar" onClick={create}>
          {active ? "Générer un nouveau lien" : "Créer mon lien d'abonnement"}
        </Button>
        {active && (
          <Button
            variant="ghost"
            className="text-red-700"
            onClick={async () => {
              await apiFetch("/api/calendar/token", { method: "DELETE" }).catch(() => undefined);
              setActive(false);
              setUrl(null);
            }}
          >
            Désactiver
          </Button>
        )}
      </div>
      {active && !url && <p className="mt-2 text-xs text-slate-500">Un lien est actif. Générer un nouveau lien désactive l&apos;ancien.</p>}
      {error && <p className="mt-2 text-red-700">{error}</p>}
    </div>
  );
}
