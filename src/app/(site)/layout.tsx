import { SiteFooter, SiteHeader } from "@/components/site/site-chrome";
import { getCurrentUser } from "@/server/auth/current-user";

export default async function SiteLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  return (
    <div className="flex min-h-dvh flex-col bg-white">
      <SiteHeader loggedIn={!!user} />
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
