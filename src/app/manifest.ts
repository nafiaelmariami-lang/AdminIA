import type { MetadataRoute } from "next";

/**
 * Application installable (écran d'accueil du téléphone, ordinateur).
 * Volontairement sans service worker : aucune page contenant des données personnelles
 * n'est mise en cache sur l'appareil.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/app",
    name: "AdminIA — vos courriers administratifs expliqués",
    short_name: "AdminIA",
    description: "Photographiez vos courriers : AdminIA vous dit ce que c'est, ce que vous devez faire et vous rappelle avant l'échéance.",
    lang: "fr",
    dir: "ltr",
    start_url: "/app",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#2554e8",
    categories: ["business", "productivity", "finance"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Ajouter un courrier", short_name: "Ajouter", url: "/app/documents", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Mes échéances", short_name: "Échéances", url: "/app/echeances", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
