import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AdminIA — vos courriers administratifs enfin compris", template: "%s · AdminIA" },
  description:
    "AdminIA lit vos courriers Urssaf, impôts, assurances et factures, vous dit quoi faire et pour quand, et vous rappelle vos échéances. Pour indépendants, artisans et TPE.",
  robots: { index: true, follow: true },
  applicationName: "AdminIA",
  appleWebApp: { capable: true, title: "AdminIA", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#2554e8", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Rendu dynamique de toutes les pages : nécessaire pour appliquer le nonce CSP de chaque requête.
  await connection();
  return (
    <html lang="fr">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
