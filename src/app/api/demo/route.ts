import { NextResponse, type NextRequest } from "next/server";

const DEMO_COOKIE = "halo_demo";

/**
 * Entrée / sortie EXPLICITE de la démo. Dans un déploiement connecté, les pages de démo
 * (données dans le navigateur) ne s'ouvrent qu'après ce passage volontaire, jamais par erreur.
 */
export function GET(request: NextRequest) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const to = url.searchParams.get("to") ?? "/fr/today";
  const locale = /^\/(fr|en|es|pt|it|de)\//.exec(to)?.[1] ?? "fr";
  if (action === "exit") {
    const res = NextResponse.redirect(new URL(`/${locale}`, url.origin));
    res.cookies.delete(DEMO_COOKIE);
    return res;
  }
  const safe = /^\/(fr|en|es|pt|it|de)\/(today|a\/today)$/.test(to) ? to : `/${locale}/today`;
  const res = NextResponse.redirect(new URL(safe, url.origin));
  res.cookies.set(DEMO_COOKIE, "1", { path: "/", sameSite: "lax", httpOnly: true, secure: url.protocol === "https:", maxAge: 60 * 60 * 8 });
  return res;
}
