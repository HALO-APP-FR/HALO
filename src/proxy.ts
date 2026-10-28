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
export default async function proxy(request: NextRequest) {
  const response = intl(request);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !/\/app(\/|$)/.test(request.nextUrl.pathname)) return response;
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
