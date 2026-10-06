"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Alert, Button } from "@/components/ui/primitives";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const f = new FormData(e.currentTarget);
    try {
      if (mode === "register") {
        await apiFetch("/api/auth/register", {
          method: "POST",
          json: { name: f.get("name"), email: f.get("email"), password: f.get("password"), acceptTerms: f.get("acceptTerms") === "on" },
        });
      } else {
        const res = await apiFetch<{ mfaRequired?: boolean; challenge?: string }>("/api/auth/login", {
          method: "POST",
          json: { email: f.get("email"), password: f.get("password") },
        });
        if (res.mfaRequired && res.challenge) {
          setChallenge(res.challenge);
          setPending(false);
          return;
        }
      }
      router.replace("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setPending(false);
    }
  }

  if (challenge) return <MfaStep challenge={challenge} onRestart={() => setChallenge(null)} />;

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate={false}>
      {error && <Alert tone="danger">{error}</Alert>}
      {mode === "register" && (
        <label className="block text-sm font-medium text-slate-700">
          Votre nom
          <input name="name" required maxLength={100} autoComplete="name" className={inputClass} placeholder="Marie Dupont" />
        </label>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Adresse e-mail
        <input name="email" type="email" required autoComplete="email" inputMode="email" className={inputClass} placeholder="vous@exemple.fr" />
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Mot de passe
        <input
          name="password"
          type="password"
          required
          minLength={mode === "register" ? 10 : undefined}
          maxLength={128}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          className={inputClass}
        />
        {mode === "register" && <span className="mt-1 block text-xs font-normal text-slate-500">Au moins 10 caractères. Une phrase facile à retenir fonctionne très bien.</span>}
      </label>
      {mode === "login" && (
        <p className="-mt-2 text-right text-sm">
          <Link href="/mot-de-passe-oublie" className="font-medium text-brand-700 hover:underline">
            Mot de passe oublié ?
          </Link>
        </p>
      )}
      {mode === "register" && (
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input name="acceptTerms" type="checkbox" required className="mt-1 h-4 w-4 rounded border-slate-300" />
          <span>
            J&apos;accepte les{" "}
            <Link href="/cgu" className="font-medium text-brand-700 underline" target="_blank">
              conditions d&apos;utilisation
            </Link>{" "}
            et la{" "}
            <Link href="/confidentialite" className="font-medium text-brand-700 underline" target="_blank">
              politique de confidentialité
            </Link>
            .
          </span>
        </label>
      )}
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Un instant…" : mode === "register" ? "Créer mon compte gratuit" : "Se connecter"}
      </Button>
      <p className="text-center text-sm text-slate-600">
        {mode === "register" ? (
          <>
            Déjà un compte ?{" "}
            <Link href="/connexion" className="font-semibold text-brand-700">
              Se connecter
            </Link>
          </>
        ) : (
          <>
            Pas encore de compte ?{" "}
            <Link href="/inscription" className="font-semibold text-brand-700">
              Créer un compte gratuit
            </Link>
          </>
        )}
      </p>
    </form>
  );
}

/** Seconde étape de connexion : code à 6 chiffres de l'application, ou code de secours. */
function MfaStep({ challenge, onRestart }: { challenge: string; onRestart: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [recovery, setRecovery] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    try {
      await apiFetch("/api/auth/mfa", { method: "POST", json: { challenge, code } });
      router.replace("/app");
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Une erreur est survenue.";
      if (/expirée/.test(message)) {
        onRestart();
        return;
      }
      setError(message);
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <h2 className="text-lg font-semibold text-slate-900">Double authentification</h2>
      {error && <Alert tone="danger">{error}</Alert>}
      <label className="block text-sm font-medium text-slate-700">
        {recovery ? "Code de secours" : "Code à 6 chiffres de votre application"}
        {recovery ? (
          <input key="recovery" name="code" required autoComplete="off" autoFocus maxLength={20} className={inputClass} placeholder="XXXXX-XXXXX" />
        ) : (
          <input
            key="totp"
            name="code"
            required
            autoComplete="one-time-code"
            inputMode="numeric"
            pattern="[0-9 ]{6,7}"
            maxLength={7}
            autoFocus
            className={`${inputClass} tracking-widest`}
            placeholder="123456"
          />
        )}
      </label>
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Vérification…" : "Valider"}
      </Button>
      <div className="flex flex-col gap-2 text-center text-sm">
        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setRecovery((r) => !r)}>
          {recovery ? "Utiliser l'application" : "Téléphone indisponible ? Utiliser un code de secours"}
        </button>
        <button type="button" className="text-slate-600 hover:underline" onClick={onRestart}>
          Revenir à l&apos;écran de connexion
        </button>
      </div>
    </form>
  );
}
