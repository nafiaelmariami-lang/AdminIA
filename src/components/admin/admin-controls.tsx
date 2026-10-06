"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";

const SETTING_LABELS: Record<string, { label: string; help: string }> = {
  ai_analysis_enabled: { label: "Analyses IA", help: "Coupe immédiatement tous les appels à l'IA (coupe-circuit de coût)." },
  uploads_enabled: { label: "Ajout de documents", help: "Empêche tout nouvel ajout de fichier." },
  registrations_enabled: { label: "Inscriptions", help: "Ferme les nouvelles inscriptions (bêta sur invitation)." },
};

export function SettingToggle({ settingKey, value }: { settingKey: string; value: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = SETTING_LABELS[settingKey] ?? { label: settingKey, help: "" };
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="font-medium text-slate-900">{meta.label}</p>
        <p className="text-sm text-slate-600">{meta.help}</p>
        {error && (
          <p className="mt-1 text-sm text-red-700" role="alert">
            {error}
          </p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={value}
        aria-label={meta.label}
        disabled={pending}
        onClick={async () => {
          if (value && !window.confirm(`Désactiver « ${meta.label} » pour tous les utilisateurs ?`)) return;
          setPending(true);
          setError(null);
          try {
            await apiFetch("/api/admin/settings", { method: "POST", json: { key: settingKey, value: !value } });
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Échec.");
          }
          setPending(false);
        }}
        className={`relative mt-1 inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${value ? "bg-emerald-600" : "bg-red-500"}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : "translate-x-0.5"}`} />
      </button>
    </div>
  );
}

export function PlanSelect({ userId, email, plan, locked }: { userId: string; email: string; plan: string; locked: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (locked) return <span className="text-xs text-slate-500" title="Abonnement Stripe en cours : la formule se gère dans Stripe">{plan} (Stripe)</span>;
  return (
    <div>
      <select
        aria-label={`Formule de ${email}`}
        defaultValue={plan}
        disabled={pending}
        className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm"
        onChange={async (e) => {
          const next = e.currentTarget.value;
          const select = e.currentTarget;
          if (!window.confirm(`Passer ${email} en formule « ${next} » ?`)) {
            select.value = plan;
            return;
          }
          setPending(true);
          setError(null);
          try {
            await apiFetch(`/api/admin/users/${userId}/plan`, { method: "POST", json: { plan: next } });
            router.refresh();
          } catch (err) {
            select.value = plan;
            setError(err instanceof Error ? err.message : "Échec.");
          }
          setPending(false);
        }}
      >
        <option value="free">Découverte</option>
        <option value="essentiel">Essentiel</option>
        <option value="pro">Pro</option>
      </select>
      {error && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** Confirme l'adresse d'un testeur (bêta sans e-mail). N'ouvre aucun accès au compte ni aux documents. */
export function VerifyEmailButton({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        aria-label={`Confirmer l'adresse de ${email}`}
        className="mt-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-50"
        onClick={async () => {
          if (!window.confirm(`Confirmer manuellement l'adresse ${email} ? Ne le faites que si vous savez que cette adresse appartient bien à ce testeur.`)) return;
          setPending(true);
          setError(null);
          try {
            await apiFetch(`/api/admin/users/${userId}/verify-email`, { method: "POST" });
            router.refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : "Échec.");
          }
          setPending(false);
        }}
      >
        {pending ? "…" : "Confirmer l'adresse"}
      </button>
      {error && (
        <p className="mt-1 text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
