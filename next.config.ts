import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// En-têtes de sécurité communs à toutes les réponses. La CSP des pages (avec nonce) est posée par src/proxy.ts.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  ...(isDev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Modules natifs ou WebAssembly : chargés tels quels par Node, sans passer par le bundler.
  serverExternalPackages: ["@node-rs/argon2", "@electric-sql/pglite", "pg", "unpdf", "mammoth"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Les réponses d'API ne sont jamais des pages : aucune ressource ne doit pouvoir s'y charger.
      // (sauf l'affichage d'un document original, qui définit sa propre politique isolée)
      {
        source: "/api/:path((?!documents/[^/]+/file$).*)",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'none'; sandbox" }],
      },
    ];
  },
};

export default nextConfig;
