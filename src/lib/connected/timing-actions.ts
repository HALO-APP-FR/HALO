"use server";

/**
 * Arrivée anticipée / départ tardif : décision explicite côté serveur (timing_decide).
 * La base revérifie les contraintes sous verrou, met à jour le séjour et les échéances ensemble,
 * et refuse si le séjour a changé depuis l'affichage. Un créneau planifié n'est jamais déplacé.
 */
import { revalidatePath } from "next/cache";
import { getContext, isManagerRole } from "./context";
import { processOutbox } from "./outbox";
import { syncTasks, type Result } from "./actions";

export interface TimingCheck {
  status: string;
  kind: "early_checkin" | "late_checkout";
  requested_at: string;
  current_at: string;
  change: boolean;
  cleaning?: { id: string; status: string; assignee_id: string | null; window_start: string; window_end: string; duration_min: number; scheduled_start: string | null } | null;
  /** Effet sur chaque action indispensable ouverte : due_moved (échéance avancée avec l'arrivée), due_after, due_before, no_due */
  actions?: { id: string; title: string; due_at: string | null; task_status: string | null; effect?: "due_moved" | "due_after" | "due_before" | "no_due" }[];
  done_actions?: number;
  incidents?: { open: number; linen: number };
  /** applied / superseded / covered / contradiction / pending / declined / cancelled / done (règle unique : public.timing_state) */
  state?: string;
  superseded_by?: string | null;
  superseded_by_at?: string | null;
  /** Rien à modifier : même heure, ou heure déjà plus favorable */
  no_change?: "same_time" | "already_better";
  /** Effet prévu sur chaque mission liée : deadline / start / shift (modifiées), unchanged_* (laissées telles quelles), blocking */
  tasks?: { id: string; type: string; title: string | null; status: string; assignee_id: string | null; window_start: string; window_end: string; duration_min: number; scheduled_start: string | null; effect: string }[];
  /** Vraie contradiction : confirmée, promesse non tenue par l'horaire du séjour (state = contradiction) */
  legacy_mismatch?: boolean;
  risks: string[];
  blocking: string[];
  unverified?: string[];
}

export async function decideTiming(
  serviceId: string,
  act: "confirm" | "cancel" | "apply_legacy",
  input: { ack: boolean; expectedAt: string | null; message: string; note: string },
): Promise<Result<{ status: string; check?: TimingCheck }>> {
  const ctx = await getContext();
  if (!ctx.user) return { ok: false, error: "not_signed_in" };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ok: false, error: "forbidden" };
  const { data, error } = await ctx.supabase.rpc("timing_decide", {
    org: ctx.org.id,
    service: serviceId,
    act,
    ack: input.ack,
    expected_at: input.expectedAt,
    guest_message: input.message.trim() || null,
    internal_note: input.note.trim() || null,
  });
  if (error) {
    // Journal serveur (sans donnée personnelle) : code et message de la base, pour diagnostiquer en préproduction
    console.error("timing_decide", act, error.code, error.message);
    return { ok: false, error: error.code === "42501" ? "forbidden" : error.code === "P0002" ? "not_found" : error.message?.includes("invalid_window") ? "timing_window" : error.message?.includes("use_timing_decision") ? "conflict" : "server" };
  }
  const res = data as { status: string; check?: TimingCheck; property?: string; changed?: boolean; restored?: boolean };
  if (res.status === "applied") {
    // Missions recalculées selon la nouvelle heure (règles habituelles), e-mails envoyés selon le résultat réel
    if (res.property && (res.changed || res.restored)) await syncTasks(res.property);
    await processOutbox(ctx.org.id);
    revalidatePath("/", "layout");
  }
  return { ok: true, data: { status: res.status, check: res.check } };
}
