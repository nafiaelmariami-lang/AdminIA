"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Alert, Button } from "@/components/ui/primitives";

const field =
  "mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 text-base focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

type Setup = { secret: string; qrSvg: string };

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="space-y-3">
      <Alert tone="warning" title="Notez ces codes de secours maintenant">
        Ils ne seront plus jamais affichés. Chacun permet une seule connexion si vous perdez votre téléphone. Rangez-les hors de votre téléphone (papier, gestionnaire de mots de passe).
      </Alert>
      <ul className="grid grid-cols-2 gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-900" aria-label="Codes de secours">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <Button type="button" onClick={onDone}>
        J&apos;ai noté mes codes
      </Button>
    </div>
  );
}

/** Formulaire mot de passe + code, partagé par la désactivation et la régénération des codes de secours. */
function ConfirmForm({ action, label, danger, onDone, onCancel }: { action: "disable" | "recovery-codes"; label: string; danger?: boolean; onDone: (codes?: string[]) => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  return (
    <form
      className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setPending(true);
        setError(null);
        try {
          const res = await apiFetch<{ recoveryCodes?: string[] }>(`/api/account/2fa/${action}`, { method: "POST", json: { password: f.get("password"), code: f.get("code") } });
          onDone(res.recoveryCodes);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          setPending(false);
        }
      }}
    >
      <label className="block text-sm font-medium text-slate-800">
        Votre mot de passe
        <input name="password" type="password" required autoComplete="current-password" className={field} />
      </label>
      <label className="block text-sm font-medium text-slate-800">
        Code de l&apos;application (ou code de secours)
        <input name="code" required autoComplete="one-time-code" maxLength={20} className={field} />
      </label>
      {error && (
        <p className="text-sm text-red-800" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant={danger ? "danger" : "primary"} disabled={pending}>
          {pending ? "Un instant…" : label}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function TwoFactorSettings({ enabled, recoveryCodesLeft }: { enabled: boolean; recoveryCodesLeft: number }) {
  const router = useRouter();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [mode, setMode] = useState<"disable" | "recovery-codes" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = () => {
    setCodes(null);
    setSetup(null);
    setMode(null);
    router.refresh();
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={finish} />;

  if (enabled) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-700">
          <span className="mr-2 rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">Activée</span>
          Un code de votre application est demandé à chaque connexion.
        </p>
        <p className={`text-sm ${recoveryCodesLeft <= 3 ? "font-medium text-amber-800" : "text-slate-600"}`}>
          Codes de secours restants : {recoveryCodesLeft} / 10{recoveryCodesLeft <= 3 ? " — pensez à en générer de nouveaux." : ""}
        </p>
        {mode ? (
          <ConfirmForm
            action={mode}
            danger={mode === "disable"}
            label={mode === "disable" ? "Désactiver" : "Générer de nouveaux codes"}
            onCancel={() => setMode(null)}
            onDone={(c) => (c ? setCodes(c) : finish())}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setMode("recovery-codes")}>
              Nouveaux codes de secours
            </Button>
            <Button variant="ghost" className="text-red-700" onClick={() => setMode("disable")}>
              Désactiver…
            </Button>
          </div>
        )}
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-slate-600">
          Protégez vos documents même si votre mot de passe est volé : un code à 6 chiffres de votre téléphone sera demandé à chaque connexion (Google Authenticator, Microsoft Authenticator, Authy, 1Password…).
        </p>
        {error && <Alert tone="danger">{error}</Alert>}
        <Button
          disabled={pending}
          onClick={async () => {
            setPending(true);
            setError(null);
            try {
              setSetup(await apiFetch<Setup>("/api/account/2fa/setup", { method: "POST" }));
            } catch (err) {
              setError(err instanceof Error ? err.message : "Une erreur est survenue.");
            }
            setPending(false);
          }}
        >
          {pending ? "Un instant…" : "Activer la double authentification"}
        </Button>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const code = String(new FormData(e.currentTarget).get("code") ?? "");
        setPending(true);
        setError(null);
        try {
          const res = await apiFetch<{ recoveryCodes: string[] }>("/api/account/2fa/enable", { method: "POST", json: { code } });
          setCodes(res.recoveryCodes);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Une erreur est survenue.");
        }
        setPending(false);
      }}
    >
      <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
        <li>Ouvrez votre application d&apos;authentification et scannez ce QR code.</li>
        <li>Saisissez le code à 6 chiffres qu&apos;elle affiche.</li>
      </ol>
      <div className="flex flex-col items-start gap-4 sm:flex-row">
        {/* SVG généré côté serveur par la bibliothèque qrcode, affiché comme image (aucun script). */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`data:image/svg+xml;utf8,${encodeURIComponent(setup.qrSvg)}`} alt="QR code à scanner avec l'application" width={176} height={176} className="rounded-lg border border-slate-200 bg-white p-2" />
        <div className="min-w-0 text-sm text-slate-600">
          <p>Impossible de scanner ? Saisissez cette clé dans l&apos;application :</p>
          <p className="mt-1 rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-900 [overflow-wrap:anywhere]">{setup.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
        </div>
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      <label className="block max-w-xs text-sm font-medium text-slate-700">
        Code à 6 chiffres
        <input name="code" required autoComplete="one-time-code" inputMode="numeric" pattern="[0-9 ]{6,7}" maxLength={7} className={`${field} tracking-widest`} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Vérification…" : "Confirmer l'activation"}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setSetup(null)}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
