import "server-only";
import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";

/**
 * Clé administrative : SERVEUR UNIQUEMENT (jamais préfixée NEXT_PUBLIC_, jamais importée côté navigateur).
 * Usage limité à l'envoi des notifications de la file d'attente.
 */
export function supabaseAdmin() {
  // Ancien nom (service_role) ou nouvelle clé secrète Supabase (sb_secret_…)
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) return null;
  return createClient(SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
