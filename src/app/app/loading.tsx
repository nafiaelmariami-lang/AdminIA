/** Indicateur affiché pendant le chargement d'une page de l'espace connecté. */
export default function Loading() {
  return (
    <div className="flex items-center gap-3 py-16 text-slate-500" role="status" aria-live="polite">
      <span className="block h-5 w-5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" aria-hidden="true" />
      Chargement…
    </div>
  );
}
