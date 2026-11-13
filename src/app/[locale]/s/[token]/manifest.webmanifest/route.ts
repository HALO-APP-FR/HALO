import { locales } from "@/i18n/routing";

/**
 * Manifeste propre au séjour : une fois ajouté à l'écran d'accueil (iPhone), HALO rouvre la page de CE séjour,
 * condition d'Apple pour recevoir des notifications. Aucune donnée du séjour n'est lue ici.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ locale: string; token: string }> }) {
  const { locale, token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token) || !(locales as readonly string[]).includes(locale)) return new Response("Not found", { status: 404 });
  const path = `/${locale}/s/${token}`;
  return Response.json(
    {
      name: "HALO · Mon séjour",
      short_name: "Mon séjour",
      start_url: path,
      scope: path,
      display: "standalone",
      background_color: "#ffffff",
      theme_color: "#ffffff",
      icons: [
        { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
    },
    { headers: { "content-type": "application/manifest+json", "cache-control": "private, no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex" } },
  );
}
