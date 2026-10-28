import "server-only";
import nodemailer from "nodemailer";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL, isConnected } from "@/lib/supabase/config";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type CheckState = "ok" | "fail" | "missing";
export interface Health {
  configured: boolean;
  checks: { key: "api" | "migrations" | "anonBlocked" | "auth" | "serverKey" | "email"; state: CheckState }[];
  /** Le parcours connecté est utilisable : API, base migrée, authentification. */
  ready: boolean;
  at: string;
}

const withTimeout = <T,>(p: Promise<T>, ms = 6000) => Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
let cache: { at: number; value: Health } | null = null;

/**
 * Vérifie RÉELLEMENT le backend (aucune valeur secrète n'est renvoyée, seulement des états) :
 * API joignable, migrations appliquées, lecture anonyme refusée, authentification, clé serveur, service d'envoi.
 */
export async function backendHealth(): Promise<Health> {
  if (cache && Date.now() - cache.at < 60_000) return cache.value;
  const at = new Date().toISOString();
  if (!isConnected()) return { configured: false, checks: [], ready: false, at };
  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const checks: Health["checks"] = [];

  // API + migrations : la fonction voyageur répond « indisponible » à un lien inventé
  try {
    const { data, error } = await withTimeout(Promise.resolve(anon.rpc("get_guest_stay", { token: "0".repeat(64) })));
    checks.push({ key: "api", state: error && !error.code ? "fail" : "ok" });
    checks.push({ key: "migrations", state: !error && (data as { status?: string })?.status === "unavailable" ? "ok" : "fail" });
  } catch {
    checks.push({ key: "api", state: "fail" }, { key: "migrations", state: "fail" });
  }
  // Lecture directe d'une table par un visiteur anonyme : doit être refusée ou vide
  try {
    const { data, error } = await withTimeout(Promise.resolve(anon.from("organizations").select("id").limit(1)));
    checks.push({ key: "anonBlocked", state: error || (data ?? []).length === 0 ? "ok" : "fail" });
  } catch {
    checks.push({ key: "anonBlocked", state: "fail" });
  }
  // Authentification par e-mail activée
  try {
    const r = await withTimeout(fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY }, cache: "no-store" }));
    const s = (await r.json()) as { external?: { email?: boolean } };
    checks.push({ key: "auth", state: r.ok && s.external?.email ? "ok" : "fail" });
  } catch {
    checks.push({ key: "auth", state: "fail" });
  }
  // Clé serveur (file d'envoi des e-mails)
  const admin = supabaseAdmin();
  if (!admin) checks.push({ key: "serverKey", state: "missing" });
  else {
    try {
      const { error } = await withTimeout(Promise.resolve(admin.from("notification_outbox").select("id", { head: true, count: "exact" })));
      checks.push({ key: "serverKey", state: error ? "fail" : "ok" });
    } catch {
      checks.push({ key: "serverKey", state: "fail" });
    }
  }
  // Service d'envoi : connexion et authentification SMTP vérifiées, sans envoyer de message
  const { SMTP_URL, SMTP_HOST, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_URL && !(SMTP_HOST && SMTP_USER && SMTP_PASS)) checks.push({ key: "email", state: "missing" });
  else {
    try {
      const port = Number(process.env.SMTP_PORT || 587);
      const t = SMTP_URL ? nodemailer.createTransport(SMTP_URL) : nodemailer.createTransport({ host: SMTP_HOST, port, secure: port === 465, auth: { user: SMTP_USER!, pass: SMTP_PASS! } });
      await withTimeout(t.verify(), 8000);
      checks.push({ key: "email", state: "ok" });
    } catch {
      checks.push({ key: "email", state: "fail" });
    }
  }
  const okOf = (k: string) => checks.find((c) => c.key === k)?.state === "ok";
  const value: Health = { configured: true, checks, ready: okOf("api") && okOf("migrations") && okOf("auth") && okOf("anonBlocked"), at };
  cache = { at: Date.now(), value };
  return value;
}
