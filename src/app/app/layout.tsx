import type { Metadata } from "next";
import { AppNav } from "@/components/app/app-nav";
import { Alert } from "@/components/ui/primitives";
import { requirePageUser } from "@/server/auth/current-user";
import { isDemoMode } from "@/server/ai/provider";
import { getPlan } from "@/lib/plans";
import { getConfig } from "@/server/config";
import { VerifyEmailBanner } from "@/components/app/verify-email-banner";
import { devOutboxDir, isDevOutboxEnabled } from "@/server/email/dev-outbox";
import { isAdminEmail } from "@/server/admin/access";

export const metadata: Metadata = { title: "Mon espace", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();
  return (
    <div className="min-h-dvh bg-slate-50">
      <AppNav userName={user.name} planLabel={getPlan(user.plan).label} isAdmin={isAdminEmail(user.email)} />
      <div className="pb-24 lg:pb-10 lg:pl-64">
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:py-10">
          {isDemoMode() && (
            <div className="mb-6">
              <Alert tone="warning" title="Mode démonstration">
                L&apos;analyse utilise un moteur simplifié local (aucune IA réelle n&apos;est appelée). Configurez une clé API pour activer l&apos;analyse complète.
              </Alert>
            </div>
          )}
          {getConfig().EMAIL_VERIFICATION_REQUIRED && !user.emailVerifiedAt && <VerifyEmailBanner email={user.email} devOutbox={isDevOutboxEnabled() ? devOutboxDir() : null} />}
          {children}
        </main>
      </div>
    </div>
  );
}
