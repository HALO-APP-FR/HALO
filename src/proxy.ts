import { NextResponse, type NextRequest } from "next/server";
import createMiddleware from "next-intl/middleware";
import { createServerClient } from "@supabase/ssr";
import { routing } from "./i18n/routing";

const intl = createMiddleware(routing);

/**
 * 1. Langue (next-intl). 2. En mode connecté, rafraîchit la session Supabase (cookies).
 * Le proxy ne donne aucun droit : chaque page et chaque action revérifient la session,
 * et la base applique ses règles d'accès.
 */
/** Pages de la DÉMO (données locales au navigateur), distinctes de l'environnement connecté (/app, /s, /invite). */
const DEMO_ROUTE = /^\/(fr|en|es|pt|it|de)\/(today|planning|tasks|properties|team|settings|services|alerts|arrivals|linen|login|unlock|a|g)(\/|$)/;

export default async function proxy(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const path = request.nextUrl.pathname;
  // Déploiement connecté : une page de démo ne s'ouvre qu'après l'entrée explicite « Démo » ;
  // sinon, retour à la connexion (aucune donnée locale ne peut passer pour l'environnement réel).
  const demo = DEMO_ROUTE.exec(path);
  if (url && key && demo && request.cookies.get("halo_demo")?.value !== "1") {
    return NextResponse.redirect(new URL(`/${demo[1]}/auth/sign-in?from=demo`, request.url));
  }
  const response = intl(request);
  if (!url || !key || !/\/app(\/|$)/.test(path)) return response;
  if (response.headers.get("location")) return response;
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response instanceof NextResponse ? response : NextResponse.next();
}

export const config = {
  // Tout sauf les routes API, les fichiers internes Next et les fichiers statiques
  matcher: ["/((?!api|_next|_vercel|.*\\..*).*)"],
};
