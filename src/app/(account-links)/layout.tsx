import { AuthShell } from "@/components/auth/auth-shell";

/** Pages ouvertes depuis un lien reçu par e-mail : accessibles connecté ou non. */
export default function AccountLinksLayout({ children }: { children: React.ReactNode }) {
  return <AuthShell>{children}</AuthShell>;
}
