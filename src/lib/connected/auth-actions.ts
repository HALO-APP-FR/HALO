"use server";

import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";

export type AuthResult = { ok: true } | { ok: false; error: "invalid_email" | "send_failed" | "invalid_code" | "rate_limited" };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Envoie un e-mail de connexion contenant un lien ET un code à 6 chiffres. */
/** Chemin interne autorisé après connexion (jamais une URL externe). */
export const safeNext = async (next: string | undefined) => (next && /^\/(app|invite)(\/[\w-]*)*$/.test(next) ? next : "/app");

export async function sendSignInEmail(email: string, locale: string, next?: string): Promise<AuthResult> {
  const clean = email.trim().toLowerCase();
  if (!EMAIL_RE.test(clean)) return { ok: false, error: "invalid_email" };
  const supabase = await supabaseServer();
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const { error } = await supabase.auth.signInWithOtp({
    email: clean,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/api/auth/callback?next=/${locale}${await safeNext(next)}` },
  });
  if (error) return { ok: false, error: error.status === 429 ? "rate_limited" : "send_failed" };
  return { ok: true };
}

export async function verifySignInCode(email: string, code: string): Promise<AuthResult> {
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token: code.trim(), type: "email" });
  if (error) return { ok: false, error: error.status === 429 ? "rate_limited" : "invalid_code" };
  return { ok: true };
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
}
