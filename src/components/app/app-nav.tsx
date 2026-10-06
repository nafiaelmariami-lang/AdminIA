"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/icon";
import { Logo } from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api-client";

const LINKS: { href: string; label: string; short: string; icon: IconName }[] = [
  { href: "/app", label: "Tableau de bord", short: "Accueil", icon: "home" },
  { href: "/app/documents", label: "Documents", short: "Documents", icon: "document" },
  { href: "/app/echeances", label: "Échéances", short: "Échéances", icon: "calendar" },
  { href: "/app/historique", label: "Historique", short: "Historique", icon: "history" },
  { href: "/app/compte", label: "Mon compte", short: "Compte", icon: "user" },
];

function isActive(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname.startsWith(href);
}

export function AppNav({ userName, planLabel, isAdmin = false }: { userName: string; planLabel: string; isAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.replace("/connexion");
    router.refresh();
  }

  return (
    <>
      {/* Barre latérale (ordinateur) */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-16 items-center px-6">
          <Link href="/app" aria-label="Tableau de bord">
            <Logo />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4" aria-label="Navigation principale">
          {LINKS.map((l) => {
            const active = isActive(pathname, l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${active ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"}`}
              >
                <Icon name={l.icon} />
                {l.label}
              </Link>
            );
          })}
          {isAdmin && (
            <Link
              href="/app/admin"
              aria-current={pathname.startsWith("/app/admin") ? "page" : undefined}
              className={`mt-4 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${pathname.startsWith("/app/admin") ? "bg-brand-50 text-brand-700" : "text-slate-700 hover:bg-slate-100"}`}
            >
              <Icon name="shield" />
              Administration
            </Link>
          )}
        </nav>
        <div className="border-t border-slate-200 p-4">
          <p className="truncate text-sm font-semibold text-slate-900">{userName}</p>
          <p className="text-xs text-slate-500">Formule {planLabel}</p>
          <button onClick={logout} className="mt-3 flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-900">
            <Icon name="logout" className="h-4 w-4" /> Se déconnecter
          </button>
        </div>
      </aside>

      {/* En-tête (mobile) */}
      <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:hidden">
        <Link href="/app" aria-label="Tableau de bord">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          {isAdmin && (
            <Link href="/app/admin" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Administration">
              <Icon name="shield" />
            </Link>
          )}
          <button onClick={logout} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100" aria-label="Se déconnecter">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      {/* Barre d'onglets (mobile) */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] lg:hidden" aria-label="Navigation principale">
        {LINKS.map((l) => {
          const active = isActive(pathname, l.href);
          return (
            <Link key={l.href} href={l.href} aria-current={active ? "page" : undefined} className={`flex flex-col items-center gap-1 py-2 text-[11px] font-medium ${active ? "text-brand-700" : "text-slate-500"}`}>
              <Icon name={l.icon} className="h-6 w-6" />
              {l.short}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
