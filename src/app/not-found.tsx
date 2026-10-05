import Link from "next/link";
import { buttonClass } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-slate-50 px-4 text-center">
      <p className="text-sm font-semibold text-brand-700">Erreur 404</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">Page introuvable</h1>
      <p className="mt-3 text-slate-600">Cette page n&apos;existe pas ou vous n&apos;y avez pas accès.</p>
      <Link href="/app" className={buttonClass("primary", "mt-6")}>
        Retour à mon espace
      </Link>
    </div>
  );
}
