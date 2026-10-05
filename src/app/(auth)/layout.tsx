import Link from "next/link";
import { redirect } from "next/navigation";
import { Logo } from "@/components/ui/primitives";
import { getCurrentUser } from "@/server/auth/current-user";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await getCurrentUser()) redirect("/app");
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-gradient-to-b from-brand-50 to-slate-50 px-4 py-10">
      <Link href="/" className="mb-8" aria-label="Accueil AdminIA">
        <Logo />
      </Link>
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">{children}</div>
      <p className="mt-6 flex items-center gap-2 text-xs text-slate-500">Connexion sécurisée · Données chiffrées · Aucun entraînement d&apos;IA sur vos documents</p>
    </div>
  );
}
