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
        await apiFetch("/api/auth/login", { method: "POST", json: { email: f.get("email"), password: f.get("password") } });
      }
      router.replace("/app");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Une erreur est survenue.");
      setPending(false);
    }
  }

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
