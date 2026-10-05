import Link from "next/link";
import { Logo, buttonClass } from "@/components/ui/primitives";

export function SiteHeader({ loggedIn }: { loggedIn: boolean }) {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="Accueil AdminIA">
          <Logo />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/tarifs" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 sm:inline-block">
            Tarifs
          </Link>
          {loggedIn ? (
            <Link href="/app" className={buttonClass("primary", "px-3 py-2")}>
              Mon espace
            </Link>
          ) : (
            <>
              <Link href="/connexion" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                Connexion
              </Link>
              <Link href="/inscription" className={buttonClass("primary", "px-3 py-2")}>
                Essai gratuit
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-slate-600 sm:flex-row sm:items-start sm:justify-between sm:px-6">
        <div className="max-w-sm">
          <Logo />
          <p className="mt-3">L&apos;assistant qui lit vos courriers administratifs et vous rappelle vos échéances.</p>
          <p className="mt-2 text-xs text-slate-500">AdminIA aide à comprendre et organiser vos documents. Il ne remplace pas un expert-comptable ni un avocat.</p>
        </div>
        <nav className="grid grid-cols-2 gap-x-10 gap-y-2" aria-label="Liens légaux">
          <Link href="/tarifs" className="hover:text-slate-900">Tarifs</Link>
          <Link href="/confidentialite" className="hover:text-slate-900">Confidentialité</Link>
          <Link href="/cgu" className="hover:text-slate-900">Conditions d&apos;utilisation</Link>
          <Link href="/mentions-legales" className="hover:text-slate-900">Mentions légales</Link>
        </nav>
      </div>
    </footer>
  );
}
