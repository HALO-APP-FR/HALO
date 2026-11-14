import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOutbox, sweepOverruns } from "@/lib/connected/outbox";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Tâche planifiée des notifications (toutes les 5 minutes, appelée par Supabase pg_cron + pg_net) :
 *   1. rappels de dépassement (agent à la fin estimée, responsable après le délai de l'organisation) ;
 *   2. envoi de la file (e-mails et push).
 * Jeton (en-tête Authorization: Bearer …) : celui du coffre Supabase (migration 34, vérifié par la base, aucun secret
 * à recopier) ou, à défaut, CRON_SECRET côté serveur. Sans jeton valide : refusée. Chaque passage est enregistré.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function authorized(req: Request) {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (got.length < 32 || got.length > 200) return false;
  const secret = process.env.CRON_SECRET ?? "";
  if (secret.length >= 32 && got.length === secret.length && timingSafeEqual(Buffer.from(got), Buffer.from(secret))) return true;
  const admin = supabaseAdmin();
  if (!admin) return false;
  const { data, error } = await admin.rpc("cron_token_ok", { token: got });
  return !error && data === true;
}

export async function GET(req: Request) {
  if (!(await authorized(req))) return NextResponse.json({ ok: false }, { status: 401 });
  const overruns = await sweepOverruns(true);
  let processed = 0;
  // Plusieurs passes de 20 (la file peut contenir plus d'éléments) dans la limite de temps
  for (let i = 0; i < 5; i++) {
    const r = await processOutbox();
    processed += r.processed ?? 0;
    if (!r.processed) break;
  }
  const admin = supabaseAdmin();
  const o = overruns && "agent" in overruns ? overruns : { agent: 0, team: 0 };
  await admin?.rpc("cron_run_record", { agent: o.agent, team: o.team, n: processed });
  return NextResponse.json({ ok: true, at: new Date().toISOString(), overruns, processed });
}
