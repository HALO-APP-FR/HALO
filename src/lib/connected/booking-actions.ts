"use server";

/**
 * Réservation directe : un ancien voyageur demande un nouveau séjour par un lien dédié (60 jours, révocable).
 * Toute décision passe par la base (droits, verrou, revérification des dates). Aucun paiement n'est géré par HALO.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getContext, isManagerRole } from "./context";
import { processOutbox } from "./outbox";
import { syncTasks, type Result } from "./actions";
import { supabaseAnon } from "@/lib/supabase/server";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}
const LOCALES = ["fr", "en", "es", "pt", "it", "de"];
async function origin() {
  const h = await headers();
  return process.env.APP_URL ?? h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

/** Lien « demander un nouveau séjour » : créé (l'ancien est remplacé), éventuellement envoyé par e-mail. */
export async function createBookingLink(reservationId: string, sendEmail: boolean, locale: string): Promise<Result<{ token: string; delivery: string | null }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: token, error: e } = await ctx.supabase.rpc("create_booking_link", { org: o, reservation: reservationId });
  if (e) return fail(e.message?.includes("stay_not_confirmed") ? "stay_not_confirmed" : e.code === "42501" ? "forbidden" : e.code === "P0002" ? "not_found" : "server");
  let delivery: string | null = null;
  if (sendEmail) {
    const { data: r } = await ctx.supabase.from("reservations").select("guest_email, guest_locale").eq("organization_id", o).eq("id", reservationId).single();
    if (!r?.guest_email) return fail("no_email");
    const lang = LOCALES.includes(r.guest_locale ?? "") ? r.guest_locale : LOCALES.includes(locale) ? locale : "fr";
    const { error: qe } = await ctx.supabase.rpc("queue_link_email", { org: o, reservation: reservationId, owner: null, tpl: "booking_link", url: `${await origin()}/${lang}/b/${token as string}` });
    if (qe) return fail("server");
    await processOutbox(o);
    const { data: last } = await ctx.supabase.from("notification_outbox").select("status").eq("organization_id", o).eq("reservation_id", reservationId).eq("template", "booking_link").order("created_at", { ascending: false }).limit(1).maybeSingle();
    delivery = (last?.status as string) ?? null;
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { token: token as string, delivery } };
}

export async function revokeBookingLink(linkId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("revoke_booking_link", { org: ctx.org!.id, link: linkId });
  if (e) return fail("server");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export interface OfferInput {
  price: number;
  fees: number;
  total: number;
  currency: string;
  conditions: string;
  validUntil: string | null;
}

export async function decideBooking(
  requestId: string,
  act: "review" | "info" | "offer" | "decline" | "cancel",
  input: { message: string; internal: string; offer?: OfferInput; altIn?: string | null; altOut?: string | null },
): Promise<Result<{ status: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("booking_decide", {
    org: ctx.org!.id,
    request: requestId,
    act,
    msg: input.message.trim() || null,
    internal: input.internal.trim() || null,
    offer_data: input.offer
      ? { price: input.offer.price, fees: input.offer.fees, total: input.offer.total, currency: input.offer.currency, conditions: input.offer.conditions, valid_until: input.offer.validUntil }
      : null,
    alt_in: input.altIn || null,
    alt_out: input.altOut || null,
  });
  if (e) {
    const known = ["question_required", "offer_incomplete", "offer_total_mismatch", "invalid_dates"].find((k) => e.message?.includes(k));
    return fail(known ?? (e.code === "42501" ? "forbidden" : "server"));
  }
  const res = data as { status: string; current?: string };
  if (res.status === "conflict") return fail(`conflict:${res.current}`);
  await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { status: res.status } };
}

/**
 * Confirmation : la base revérifie les dates sous verrou et signale les calendriers non à jour.
 * Puis : missions selon les règles habituelles, nouvel accès voyageur et invitation à préparer le séjour.
 */
export async function confirmBooking(requestId: string, ackCalendars: boolean, locale: string): Promise<Result<{ status: string; reservationId?: string; calendars?: string[]; invite?: string | null }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data, error: e } = await ctx.supabase.rpc("booking_confirm", { org: o, request: requestId, ack_calendars: ackCalendars });
  if (e) return fail(e.code === "42501" ? "forbidden" : e.message?.includes("stay_overlap") ? "dates_unavailable" : "server");
  const res = data as { status: string; reservation?: string; calendars?: string[]; current?: string };
  if (res.status === "stale_calendars") return { ok: true, data: { status: "stale_calendars", calendars: res.calendars ?? [] } };
  if (res.status === "dates_unavailable" || res.status === "not_accepted") return fail(res.status);
  const rid = res.reservation!;
  let invite: string | null = null;
  if (res.status === "applied") {
    const { data: r } = await ctx.supabase.from("reservations").select("property_id, guest_locale").eq("organization_id", o).eq("id", rid).single();
    if (r) await syncTasks(r.property_id as string);
    // Nouvel accès voyageur + invitation à préparer le séjour (même parcours que pour tout séjour)
    const { data: token } = await ctx.supabase.rpc("create_guest_link", { org: o, reservation: rid });
    if (token) {
      const lang = LOCALES.includes(locale) ? locale : "fr";
      await ctx.supabase.rpc("record_prep_invite", { org: o, reservation: rid, url: `${await origin()}/${lang}/s/${token as string}` });
    }
    await processOutbox(o);
    const { data: last } = await ctx.supabase.from("notification_outbox").select("status").eq("organization_id", o).eq("reservation_id", rid).eq("template", "prep_invite").order("created_at", { ascending: false }).limit(1).maybeSingle();
    invite = (last?.status as string) ?? null;
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { status: res.status, reservationId: rid, invite } };
}

export async function markBookingRead(requestId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  await ctx.supabase.rpc("booking_mark_read", { org: ctx.org!.id, request: requestId });
  return { ok: true, data: undefined };
}

// ---------- Côté voyageur (lien de demande, sans compte) ----------
type GuestRes = { ok: true; data: { knownConflict?: boolean } } | { ok: false; error: string };

export async function guestSubmitBooking(token: string, input: { clientId: string; checkIn: string; checkOut: string; adults: number; children: number; babies: number; name: string; email: string; phone: string; message: string }): Promise<GuestRes> {
  const { data, error } = await supabaseAnon().rpc("booking_submit", {
    token,
    client: input.clientId,
    d_in: input.checkIn,
    d_out: input.checkOut,
    n_adults: input.adults,
    n_children: input.children,
    n_babies: input.babies,
    c_name: input.name,
    c_email: input.email,
    c_phone: input.phone || null,
    msg: input.message || null,
  });
  if (error) return { ok: false, error: error.code === "23514" ? "invalid" : "server" };
  const res = data as { status: string; known_conflict?: boolean };
  if (res.status !== "ok") return { ok: false, error: res.status };
  await processOutbox();
  revalidatePath(`/[locale]/b/${token}`, "page");
  return { ok: true, data: { knownConflict: Boolean(res.known_conflict) } };
}

export async function guestBookingAction(token: string, requestId: string, act: "reply" | "accept" | "cancel", message?: string): Promise<GuestRes> {
  const { data, error } = await supabaseAnon().rpc("booking_guest_action", { token, request: requestId, act, msg: message ?? null });
  if (error) return { ok: false, error: "server" };
  const res = data as { status: string };
  if (res.status !== "ok") return { ok: false, error: res.status };
  await processOutbox();
  revalidatePath(`/[locale]/b/${token}`, "page");
  return { ok: true, data: {} };
}
