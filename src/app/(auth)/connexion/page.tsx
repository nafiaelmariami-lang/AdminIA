import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Connexion" };

export default function LoginPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Bon retour !</h1>
      <p className="mb-6 mt-1 text-slate-600">Connectez-vous à votre espace AdminIA.</p>
      <AuthForm mode="login" />
    </>
  );
}
