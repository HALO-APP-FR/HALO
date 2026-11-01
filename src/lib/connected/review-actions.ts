"use server";

/**
 * Satisfaction : liens d'avis (voyageur après séjour, propriétaire relié à un logement), suivi par l'équipe,
 * avis importés, propriétaires et vitrine. L'équipe ne modifie jamais la note ni le commentaire d'un auteur.
 */
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getContext, isManagerRole } from "./context";
import { processOutbox } from "./outbox";
import type { Result } from "./actions";
import { supabaseAnon } from "@/lib/supabase/server";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}
async function origin() {
  const h = await headers();
  return process.env.APP_URL ?? h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
}

export async function createReviewLink(kind: "guest" | "owner", targetId: string, sendEmail: boolean, locale: string): Promise<Result<{ token: string; delivery: string | null }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: token, error: e } = await ctx.supabase.rpc("create_review_link", { org: o, link_kind: kind, target: targetId });
  if (e) return fail(["stay_not_finished", "already_reviewed", "no_managed_property"].find((k) => e.message?.includes(k)) ?? (e.code === "42501" ? "forbidden" : "server"));
  let delivery: string | null = null;
  if (sendEmail) {
    const url = `${await origin()}/${["fr", "en", "es", "pt", "it", "de"].includes(locale) ? locale : "fr"}/avis/${token as string}`;
    const { data: queued, error: qe } = await ctx.supabase.rpc("queue_link_email", { org: o, reservation: kind === "guest" ? targetId : null, owner: kind === "owner" ? targetId : null, tpl: "review_request", url });
    if (qe) return fail("server");
    if (!queued) return fail("no_email");
    await processOutbox(o);
    let q = ctx.supabase.from("notification_outbox").select("status").eq("organization_id", o).eq("template", "review_request").order("created_at", { ascending: false }).limit(1);
    if (kind === "guest") q = q.eq("reservation_id", targetId);
    const { data: last } = await q.maybeSingle();
    delivery = (last?.status as string) ?? null;
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { token: token as string, delivery } };
}

export async function followReview(reviewId: string, status: "new" | "to_handle" | "handled", note: string, makeIncident: boolean): Promise<Result<{ incident: string | null }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("review_follow", { org: ctx.org!.id, review: reviewId, new_status: status, note: note.trim() || null, make_incident: makeIncident });
  if (e) return fail(e.message?.includes("no_property") ? "no_property" : e.code === "42501" ? "forbidden" : "server");
  revalidatePath("/", "layout");
  return { ok: true, data: { incident: (data as { incident: string | null }).incident } };
}

export async function addImportedReview(input: { kind: "guest" | "owner"; overall: number; comment: string; from: string; date: string; propertyId: string | null }): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("add_imported_review", { org: ctx.org!.id, r_kind: input.kind, r_overall: input.overall, r_comment: input.comment, r_from: input.from, r_date: input.date, prop: input.propertyId });
  if (e) return fail(e.code === "22023" ? "invalid" : "server");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function saveOwner(input: { id: string | null; name: string; email: string; phone: string; propertyIds: string[] }): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const name = input.name.trim().slice(0, 120);
  const email = input.email.trim().toLowerCase();
  if (!name || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))) return fail("invalid");
  const row = { organization_id: o, name, email: email || null, phone: input.phone.trim().slice(0, 40) || null };
  const q = input.id ? ctx.supabase.from("property_owners").update(row).eq("organization_id", o).eq("id", input.id).select("id").single() : ctx.supabase.from("property_owners").insert(row).select("id").single();
  const { data, error: e } = await q;
  if (e || !data) return fail("server");
  const id = data.id as string;
  const { error: de } = await ctx.supabase.from("owner_properties").delete().eq("organization_id", o).eq("owner_id", id);
  if (de) return fail("server");
  if (input.propertyIds.length) {
    const { error: ie } = await ctx.supabase.from("owner_properties").insert(input.propertyIds.map((p) => ({ organization_id: o, owner_id: id, property_id: p })));
    if (ie) return fail(ie.code === "23503" ? "not_found" : "server");
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function saveShowcase(input: { slug: string; title: string; intro: string; services: string; contact: string; months: number; guest: boolean; owner: boolean; testimonials: string[] }): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])$/.test(slug) || !input.title.trim()) return fail("invalid");
  const { error: e } = await ctx.supabase.rpc("save_showcase", {
    org: ctx.org!.id,
    s_slug: slug,
    s_title: input.title.trim().slice(0, 120),
    s_intro: input.intro.trim().slice(0, 2000) || null,
    s_services: input.services.trim().slice(0, 1000) || null,
    s_contact: input.contact.trim().slice(0, 300) || null,
    s_months: input.months,
    s_guest: input.guest,
    s_owner: input.owner,
    testimonials: input.testimonials,
  });
  if (e) return fail(e.message?.includes("testimonial_not_allowed") ? "testimonial_not_allowed" : e.code === "23505" ? "slug_taken" : "server");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function publishShowcase(publish: boolean): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("publish_showcase", { org: ctx.org!.id, publish });
  if (e) return fail(e.code === "P0002" ? "not_found" : "server");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Auteur de l'avis (lien personnel, sans compte) ----------
export async function submitReview(token: string, input: { overall: number; service: number | null; ratings: Record<string, number>; comment: string; wouldReturn: boolean | null; label: string; consent: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data, error } = await supabaseAnon().rpc("review_submit", {
    token,
    v_overall: input.overall,
    v_ratings: input.ratings,
    v_comment: input.comment || null,
    v_return: input.wouldReturn,
    v_label: input.label || null,
    v_consent: input.consent,
    v_service: input.service,
  });
  if (error) return { ok: false, error: "server" };
  const res = data as { status: string };
  if (res.status !== "ok") return { ok: false, error: res.status };
  await processOutbox();
  revalidatePath(`/[locale]/avis/${token}`, "page");
  return { ok: true };
}
