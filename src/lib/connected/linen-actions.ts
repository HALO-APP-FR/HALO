"use server";

/**
 * Linge opérationnel (migration 26) : catalogue, kit par logement, inventaire et mouvements de stock,
 * report d'une mission linge terminée au stock, collecte après un départ. Responsables uniquement ;
 * toutes les règles (droits, stock jamais négatif, une seule fois par mission) sont appliquées par la base.
 */
import { revalidatePath } from "next/cache";
import { getContext, isManagerRole } from "./context";
import { processOutbox } from "./outbox";
import type { Result } from "./actions";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}
const code = (e: { code?: string; message?: string } | null, known: string[] = []) => {
  if (!e) return "unknown";
  if (e.code === "PGRST202" || e.code === "42P01" || e.code === "PGRST205") return "migration_missing";
  const k = known.find((x) => e.message?.includes(x));
  if (k) return k;
  return e.code === "42501" ? "forbidden" : e.code === "23505" ? "duplicate" : e.code === "22023" || e.code === "23514" ? "invalid" : e.code === "P0002" ? "not_found" : "server";
};
const done = () => {
  revalidatePath("/", "layout");
  return { ok: true as const, data: undefined };
};

/** Catalogue de départ (modifiable) : les articles les plus courants d'une location meublée. */
const STARTER = ["Drap housse 140", "Drap housse 90", "Housse de couette 240", "Housse de couette 140", "Taie d'oreiller", "Serviette de bain", "Serviette de main", "Tapis de bain", "Torchon"];

export async function seedLinenCatalogue(): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data: existing, error: le } = await ctx.supabase.from("linen_items").select("label").eq("organization_id", ctx.org!.id).eq("active", true);
  if (le) return fail(code(le));
  const have = new Set((existing ?? []).map((x) => (x.label as string).trim().toLowerCase()));
  const rows = STARTER.filter((l) => !have.has(l.toLowerCase())).map((label, i) => ({ organization_id: ctx.org!.id, label, unit: "pièce", sort: i }));
  if (rows.length) {
    const { error: e } = await ctx.supabase.from("linen_items").insert(rows);
    if (e) return fail(code(e));
  }
  return done();
}

export async function addLinenItem(label: string, unit: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  if (!label.trim()) return fail("invalid");
  const { error: e } = await ctx.supabase.from("linen_items").insert({ organization_id: ctx.org!.id, label: label.trim().slice(0, 80), unit: unit.trim().slice(0, 20) || "pièce", sort: 100 });
  if (e) return fail(code(e));
  return done();
}

export async function updateLinenItem(id: string, patch: { label?: string; unit?: string; active?: boolean }): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const row: Record<string, unknown> = {};
  if (patch.label !== undefined) {
    if (!patch.label.trim()) return fail("invalid");
    row.label = patch.label.trim().slice(0, 80);
  }
  if (patch.unit !== undefined) row.unit = patch.unit.trim().slice(0, 20) || "pièce";
  if (patch.active !== undefined) row.active = patch.active;
  const { data, error: e } = await ctx.supabase.from("linen_items").update(row).eq("organization_id", ctx.org!.id).eq("id", id).select("id");
  if (e) return fail(code(e));
  if (!data?.length) return fail("not_found");
  return done();
}

/** Kit d'un logement : quantités par article (0 = retiré du kit). */
export async function saveLinenKit(propertyId: string, lines: { itemId: string; qty: number }[]): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const keep = lines.filter((l) => Number.isInteger(l.qty) && l.qty > 0 && l.qty <= 500);
  const drop = lines.filter((l) => !(l.qty > 0)).map((l) => l.itemId);
  if (keep.length) {
    const { error: e } = await ctx.supabase.from("property_linen_kits").upsert(
      keep.map((l) => ({ organization_id: o, property_id: propertyId, item_id: l.itemId, qty: l.qty, updated_at: new Date().toISOString(), updated_by: ctx.user!.id })),
      { onConflict: "property_id,item_id" },
    );
    if (e) return fail(code(e));
  }
  if (drop.length) {
    const { error: e } = await ctx.supabase.from("property_linen_kits").delete().eq("organization_id", o).eq("property_id", propertyId).in("item_id", drop);
    if (e) return fail(code(e));
  }
  return done();
}

export async function countLinen(itemId: string, location: string, qty: number, note: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("linen_count", { org: ctx.org!.id, item: itemId, loc: location, counted: qty, note: note || null });
  if (e) return fail(code(e));
  return done();
}

/** Mouvement entre emplacements (envoi / retour blanchisseur), entrée (achat) ou sortie (perte). */
export async function moveLinen(input: { itemId: string; kind: "to_laundry" | "from_laundry" | "purchase" | "loss"; from?: string | null; qty: number; note: string }): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const route = { to_laundry: ["dirty", "laundry"], from_laundry: ["laundry", "clean"], purchase: [null, "clean"], loss: [input.from ?? "clean", null] }[input.kind];
  if (!route) return fail("invalid");
  const { error: e } = await ctx.supabase.rpc("linen_move", { org: ctx.org!.id, item: input.itemId, from_loc: route[0], to_loc: route[1], qty: input.qty, kind: input.kind, note: input.note || null, property: null, task: null });
  if (e) return fail(code(e, ["insufficient_stock"]));
  return done();
}

/** Mission linge terminée : le kit du logement est reporté au stock (une seule fois). */
export async function applyLinenTask(taskId: string): Promise<Result<{ status: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("linen_apply_task", { org: ctx.org!.id, task: taskId });
  if (e) return fail(code(e, ["insufficient_stock"]));
  const status = (data as { status: string }).status;
  if (status === "no_kit") return fail("no_kit");
  if (status === "not_done") return fail("conflict");
  revalidatePath("/", "layout");
  return { ok: true, data: { status } };
}

/** Collecte de linge après un départ (pas de doublon, plage après le départ). */
export async function planLinenPickup(stayId: string, input: { start: string; end: string; durationMin: number; assigneeId: string | null; note: string }): Promise<Result<{ id: string; existed: boolean }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("plan_linen_pickup", {
    org: ctx.org!.id, reservation: stayId, w_start: input.start, w_end: input.end, duration: input.durationMin, assignee: input.assigneeId, note: input.note || null,
  });
  if (e) return fail(code(e, ["invalid_window", "assignee_unavailable"]));
  const res = data as { status: string; id: string };
  await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { id: res.id, existed: res.status === "exists" } };
}
