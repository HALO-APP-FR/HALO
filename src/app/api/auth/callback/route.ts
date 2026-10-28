import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Retour du lien de connexion reçu par e-mail : échange le code contre une session. */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/fr/app";
  const safeNext = /^\/[a-z]{2}\/(app|invite)(\/[\w-]*)*$/.test(next) ? next : "/fr/app";
  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(safeNext, url.origin));
  }
  return NextResponse.redirect(new URL(`${safeNext.slice(0, 3)}/auth/sign-in?error=link`, url.origin));
}
