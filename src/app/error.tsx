"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Une erreur est survenue</h1>
      <p className="mt-2 text-slate-600">Vos documents sont en sécurité. Réessayez dans un instant.</p>
      <button onClick={reset} className="mt-6 rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">
        Réessayer
      </button>
    </div>
  );
}
