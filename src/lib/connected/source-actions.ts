"use server";

/**
 * Sources externes : calendriers iCal par logement (lecture seule, à la demande).
 * Un calendrier donne des dates (et parfois un nom) : jamais toutes les données d'une réservation.
 * Règle de priorité : une fiche modifiée dans HALO n'est jamais écrasée ; l'écart devient un conflit à arbitrer.
 */
import { revalidatePath } from "next/cache";
import { parseIcs } from "@/lib/engine/ical";
import { getContext, isManagerRole } from "./context";
import { fetchFeed } from "./feed-fetch";
import type { Result } from "./actions";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}

export async function addIcalSource(propertyId: string, url: string, label: string, platform: "airbnb" | "booking" | "vrbo" | "other"): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("add_ical_source", { org: ctx.org!.id, prop: propertyId, feed_url: url, feed_label: label, feed_platform: platform });
  if (e) return fail(e.message?.includes("invalid_url") ? "invalid_url" : e.code === "42501" ? "forbidden" : e.code === "P0002" ? "not_found" : "server");
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

export async function syncIcalSource(sourceId: string): Promise<Result<{ created: number; updated: number; unchanged: number; conflicts: number; missing: number }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: src } = await ctx.supabase.from("data_sources").select("id, status, property_id, properties(timezone, default_check_in, default_check_out)").eq("organization_id", o).eq("id", sourceId).maybeSingle();
  if (!src) return fail("not_found");
  if (src.status === "paused") return fail("paused");
  const { data: url } = await ctx.supabase.rpc("ical_source_url", { org: o, source: sourceId });
  if (!url) return fail("not_found");
  const feed = await fetchFeed(url as string);
  if (!feed.ok) {
    await ctx.supabase.rpc("apply_ical_sync", { org: o, source: sourceId, events: [], sync_error: feed.error });
    revalidatePath("/", "layout");
    return fail(`feed_${feed.error}`);
  }
  const p = (Array.isArray(src.properties) ? src.properties[0] : src.properties) as { timezone: string; default_check_in: string; default_check_out: string };
  let events;
  try {
    events = parseIcs(feed.text, { timezone: p.timezone, defaultCheckIn: p.default_check_in.slice(0, 5), defaultCheckOut: p.default_check_out.slice(0, 5) });
  } catch {
    await ctx.supabase.rpc("apply_ical_sync", { org: o, source: sourceId, events: [], sync_error: "not_ical" });
    return fail("feed_not_ical");
  }
  // Seuls les séjours/blocages pas encore terminés sont suivis
  const now = Date.now();
  const payload = events
    .filter((e) => Date.parse(e.checkOutAt) > now - 86_400_000 && e.status !== "cancelled")
    .slice(0, 1000)
    .map((e) => ({ uid: e.uid.slice(0, 500), check_in_at: e.checkInAt, check_out_at: e.checkOutAt, status: e.status === "blocked" ? "blocked" : "confirmed", guest_name: e.guestName?.slice(0, 120) ?? null }));
  const { data, error: e } = await ctx.supabase.rpc("apply_ical_sync", { org: o, source: sourceId, events: payload });
  if (e) return fail("server");
  revalidatePath("/", "layout");
  const r = data as { created: number; updated: number; unchanged: number; conflicts: number; missing: number };
  return { ok: true, data: r };
}

export async function setSourcePaused(sourceId: string, paused: boolean): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.from("data_sources").update({ status: paused ? "paused" : "active" }).eq("organization_id", ctx.org!.id).eq("id", sourceId).select("id");
  if (e || !data?.length) return fail(e ? "server" : "not_found");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Déconnexion : la source et son adresse sont supprimées ; les séjours déjà créés restent dans HALO. */
export async function deleteSource(sourceId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.from("data_sources").delete().eq("organization_id", ctx.org!.id).eq("id", sourceId);
  if (e) return fail("server");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function resolveSourceConflict(sourceId: string, uid: string, decision: "keep_halo" | "apply_feed" | "cancel_stay"): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("resolve_source_conflict", { org: ctx.org!.id, source: sourceId, event_uid: uid, decision });
  if (e) return fail(e.code === "42501" ? "forbidden" : e.code === "22023" ? "invalid" : e.message?.includes("stay_overlap") ? "stay_overlap" : "server");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
