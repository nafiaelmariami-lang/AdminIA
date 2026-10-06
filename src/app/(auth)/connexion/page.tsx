import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";
import { Alert } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Connexion" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ reinitialise?: string }> }) {
  const { reinitialise } = await searchParams;
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bon retour !</h1>
      <p className="mb-6 mt-1 text-slate-600">Connectez-vous à votre espace AdminIA.</p>
      {reinitialise === "1" && (
        <div className="mb-4">
          <Alert tone="success">Mot de passe modifié. Connectez-vous avec le nouveau mot de passe et votre code de double authentification.</Alert>
        </div>
      )}
      <AuthForm mode="login" />
    </>
  );
}
