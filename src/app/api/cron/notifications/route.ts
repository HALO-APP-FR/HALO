import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { processOutbox, sweepOverruns } from "@/lib/connected/outbox";

/**
 * Tâche planifiée des notifications (toutes les 5 minutes, appelée par Supabase pg_cron + pg_net) :
 *   1. rappels de dépassement (agent à la fin estimée, responsable après le délai de l'organisation) ;
 *   2. envoi de la file (e-mails et push).
 * Protégée par CRON_SECRET (en-tête Authorization: Bearer …). Sans secret configuré : refusée.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function authorized(req: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (secret.length < 32 || got.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const overruns = await sweepOverruns(true);
  let processed = 0;
  // Plusieurs passes de 20 (la file peut contenir plus d'éléments) dans la limite de temps
  for (let i = 0; i < 5; i++) {
    const r = await processOutbox();
    processed += r.processed ?? 0;
    if (!r.processed) break;
  }
  return NextResponse.json({ ok: true, at: new Date().toISOString(), overruns, processed });
}
