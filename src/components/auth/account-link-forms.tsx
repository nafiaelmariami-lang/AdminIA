"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api-client";
import { Alert, Button, buttonClass } from "@/components/ui/primitives";

const inputClass =
  "mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-base text-slate-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200";

export function ForgotPasswordForm() {
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (sent) {
    return (
      <div className="space-y-4">
        <Alert tone="success">{sent}</Alert>
        <p className="text-sm text-slate-600">Pensez à vérifier vos courriers indésirables. Le lien est valable 1 heure.</p>
        <Link href="/connexion" className={buttonClass("secondary", "w-full")}>
          Retour à la connexion
        </Link>
      </div>
    );
  }
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          const r = await apiFetch<{ message: string }>("/api/auth/password/forgot", { method: "POST", json: { email: new FormData(e.currentTarget).get("email") } });
          setSent(r.message);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Une erreur est survenue.");
        }
        setPending(false);
      }}
    >
      {error && <Alert tone="danger">{error}</Alert>}
      <label className="block text-sm font-medium text-slate-700">
        Adresse e-mail du compte
        <input name="email" type="email" required autoComplete="email" inputMode="email" className={inputClass} />
      </label>
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Envoi…" : "Recevoir un lien de réinitialisation"}
      </Button>
      <p className="text-center text-sm">
        <Link href="/connexion" className="font-semibold text-brand-700">
          Retour à la connexion
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  if (!token) return <Alert tone="danger">Lien incomplet. Ouvrez le lien reçu par e-mail ou faites une nouvelle demande.</Alert>;
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        if (f.get("password") !== f.get("confirm")) {
          setError("Les deux mots de passe ne correspondent pas.");
          return;
        }
        setPending(true);
        setError(null);
        try {
          const res = await apiFetch<{ loginRequired?: boolean }>("/api/auth/password/reset", { method: "POST", json: { token, password: f.get("password") } });
          // Compte protégé par la double authentification : reconnexion avec le second facteur.
          router.replace(res.loginRequired ? "/connexion?reinitialise=1" : "/app");
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Une erreur est survenue.");
          setPending(false);
        }
      }}
    >
      {error && (
        <Alert tone="danger">
          {error}{" "}
          {/expiré|invalide|utilisé/.test(error) && (
            <Link href="/mot-de-passe-oublie" className="font-semibold underline">
              Nouvelle demande
            </Link>
          )}
        </Alert>
      )}
      <label className="block text-sm font-medium text-slate-700">
        Nouveau mot de passe
        <input name="password" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} />
        <span className="mt-1 block text-xs font-normal text-slate-500">Au moins 10 caractères.</span>
      </label>
      <label className="block text-sm font-medium text-slate-700">
        Confirmez le mot de passe
        <input name="confirm" type="password" required minLength={10} maxLength={128} autoComplete="new-password" className={inputClass} />
      </label>
      <Button type="submit" disabled={pending} className="w-full py-3">
        {pending ? "Enregistrement…" : "Enregistrer et me connecter"}
      </Button>
    </form>
  );
}

export function VerifyEmail({ token }: { token: string }) {
  const [state, setState] = useState<"pending" | "ok" | "error">(token ? "pending" : "error");
  const [message, setMessage] = useState(token ? "" : "Lien incomplet.");
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiFetch("/api/auth/verify-email", { method: "POST", json: { token } })
      .then(() => setState("ok"))
      .catch((err: unknown) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Lien invalide.");
      });
  }, [token]);
  if (state === "pending") return <p className="text-slate-600">Confirmation en cours…</p>;
  if (state === "ok") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Adresse confirmée">
          L&apos;analyse de vos documents est activée.
        </Alert>
        <Link href="/app" className={buttonClass("primary", "w-full")}>
          Accéder à mon espace
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Alert tone="danger">{message}</Alert>
      <Link href="/app" className={buttonClass("secondary", "w-full")}>
        Aller à mon espace (renvoi du lien possible)
      </Link>
    </div>
  );
}

export function ConfirmNewEmail({ token }: { token: string }) {
  const [state, setState] = useState<"pending" | "ok" | "error">(token ? "pending" : "error");
  const [message, setMessage] = useState(token ? "" : "Lien incomplet.");
  const started = useRef(false);
  useEffect(() => {
    if (!token || started.current) return;
    started.current = true;
    apiFetch<{ email: string }>("/api/auth/email-change/confirm", { method: "POST", json: { token } })
      .then((r) => {
        setMessage(r.email);
        setState("ok");
      })
      .catch((err: unknown) => {
        setState("error");
        setMessage(err instanceof Error ? err.message : "Lien invalide.");
      });
  }, [token]);
  if (state === "pending") return <p className="text-slate-600">Confirmation en cours…</p>;
  if (state === "ok") {
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Adresse modifiée">
          Votre compte utilise désormais <strong className="[overflow-wrap:anywhere]">{message}</strong>. Utilisez-la pour vous connecter.
        </Alert>
        <Link href="/app/compte" className={buttonClass("primary", "w-full")}>
          Aller à mon compte
        </Link>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Alert tone="danger">{message}</Alert>
      <Link href="/app/compte" className={buttonClass("secondary", "w-full")}>
        Aller à mon compte
      </Link>
    </div>
  );
}

/** Annulation depuis l'ancienne adresse : action volontaire (bouton), jamais automatique à l'ouverture du lien. */
export function RevertEmailChange({ token }: { token: string }) {
  const [state, setState] = useState<"idle" | "pending" | "ok">("idle");
  const [error, setError] = useState<string | null>(token ? null : "Lien incomplet.");
  if (state === "ok") {
    return (
      <Alert tone="success" title="Changement annulé">
        Votre ancienne adresse est rétablie, toutes les sessions ont été fermées et la double authentification retirée. Un e-mail vient de vous être envoyé pour choisir un
        nouveau mot de passe.
      </Alert>
    );
  }
  return (
    <div className="space-y-4">
      <p className="text-slate-700">
        Si vous n&apos;avez pas demandé à changer l&apos;adresse de votre compte, annulez ce changement. Par précaution, toutes les sessions seront fermées et vous choisirez un
        nouveau mot de passe.
      </p>
      {error && <Alert tone="danger">{error}</Alert>}
      <button
        type="button"
        disabled={!token || state === "pending"}
        className={buttonClass("danger", "w-full")}
        onClick={async () => {
          setState("pending");
          setError(null);
          try {
            await apiFetch("/api/auth/email-change/revert", { method: "POST", json: { token } });
            setState("ok");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Lien invalide.");
            setState("idle");
          }
        }}
      >
        {state === "pending" ? "Un instant…" : "Annuler le changement et sécuriser mon compte"}
      </button>
    </div>
  );
}
