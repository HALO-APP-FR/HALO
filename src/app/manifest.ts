import type { MetadataRoute } from "next";

/** Application installable (écran d'accueil) : indispensable aux notifications push sur iPhone (iOS 16.4+). */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "HALO",
    short_name: "HALO",
    description: "Conciergerie : missions, séjours, voyageurs.",
    start_url: "/fr/app",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
