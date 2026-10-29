"use server";

import { headers } from "next/headers";
import { supabaseServer } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { testAccountsEnabled } from "./test-accounts";
import { buildTestScenario } from "./test-scenario";

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

/**
 * Préproduction : connexion à un compte de test fictif (test-<nom>@halo.invalid), sans e-mail.
 * Même nom → même compte : permet de vérifier la persistance après reconnexion et sur un autre appareil.
 */
export async function signInTestAccount(name: string): Promise<{ ok: true; email: string } | { ok: false; error: "disabled" | "invalid_name" | "server" }> {
  if (!testAccountsEnabled()) return { ok: false, error: "disabled" };
  const slug = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24);
  if (!slug) return { ok: false, error: "invalid_name" };
  const admin = supabaseAdmin();
  if (!admin) return { ok: false, error: "server" };
  const email = `test-${slug}@halo.invalid`;
  const { error: ce } = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (ce && !/already/i.test(ce.message)) return { ok: false, error: "server" };
  const { data, error: le } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (le || !data.properties?.hashed_token) return { ok: false, error: "server" };
  const supabase = await supabaseServer();
  const { error: ve } = await supabase.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "email" });
  if (ve) return { ok: false, error: "server" };
  return { ok: true, email };
}

/** Préproduction : scénario complet (manager, agent, logement, séjour, mission, lien voyageur). */
export async function prepareTestScenario(name: string): Promise<
  { ok: true; agentLabel: string; guestPath: string | null; existed: boolean } | { ok: false; error: "disabled" | "invalid_name" | "server" }
> {
  if (!testAccountsEnabled()) return { ok: false, error: "disabled" };
  const slug = name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 20);
  if (!slug) return { ok: false, error: "invalid_name" };
  try {
    const res = await buildTestScenario(slug);
    // Connexion du manager au clic suivant (la page de connexion redirigerait aussitôt une session ouverte)
    return { ok: true, agentLabel: res.agentLabel, guestPath: res.guestToken ? `/s/${res.guestToken}` : null, existed: res.existed };
  } catch {
    return { ok: false, error: "server" };
  }
}
