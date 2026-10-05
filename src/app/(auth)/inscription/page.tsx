import type { Metadata } from "next";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Créer un compte" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">Créez votre espace</h1>
      <p className="mb-6 mt-1 text-slate-600">Gratuit, sans carte bancaire. 5 analyses offertes chaque mois.</p>
      <AuthForm mode="register" />
    </>
  );
}
