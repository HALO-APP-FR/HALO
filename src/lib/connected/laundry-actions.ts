"use server";

/**
 * Blanchisseur externe (migration 32). Toutes les règles (droits, étapes, stock, historique) sont appliquées par la base ;
 * ce fichier ne fait que transmettre et traduire les résultats.
 *  - Conciergerie (responsables) : partenaires, invitations nominatives, commandes, annulation, réception confirmée.
 *  - Blanchisseur (compte invité) : acceptation de l'invitation, étapes de SES commandes.
 */
import { revalidatePath } from "next/cache";
import { getContext, isManagerRole } from "./context";
import { processOutbox } from "./outbox";
import type { Result } from "./actions";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const code = (e: { code?: string; message?: string } | null, known: string[] = []) => {
  if (!e) return "unknown";
  if (e.code === "PGRST202" || e.code === "42P01" || e.code === "PGRST205") return "migration_missing";
  const k = known.find((x) => e.message?.includes(x));
  if (k) return k;
  return e.code === "42501" ? "forbidden" : e.code === "22023" || e.code === "23514" ? "invalid" : e.code === "P0002" ? "not_found" : "server";
};
async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}
const appUrl = () => process.env.APP_URL ?? (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
const refresh = () => revalidatePath("/", "layout");

export async function saveLaundryPartner(input: { id?: string | null; name: string; contactName: string; contactEmail: string; active?: boolean }): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("laundry_partner_save", { org: ctx.org!.id, partner: input.id ?? null, p_name: input.name, p_contact: input.contactName, p_email: input.contactEmail, p_active: input.active ?? true });
  if (e) return fail(code(e));
  refresh();
  return { ok: true, data: { id: data as string } };
}

/** Invitation nominative : renvoie le lien à transmettre (valable 14 jours, pour cette adresse uniquement). */
export async function inviteLaundry(partnerId: string, contactName: string, email: string, locale: string): Promise<Result<{ url: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  if (!contactName.trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) return fail("invalid");
  const { data, error: e } = await ctx.supabase.rpc("laundry_invite", { org: ctx.org!.id, partner: partnerId, p_contact: contactName, p_email: email });
  if (e) return fail(code(e));
  refresh();
  return { ok: true, data: { url: `${appUrl()}/${locale}/laundry/invite/${data as string}` } };
}

export async function revokeLaundryInvite(inviteId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("laundry_invite_revoke", { org: ctx.org!.id, invite: inviteId });
  if (e) return fail(code(e));
  refresh();
  return { ok: true, data: undefined };
}

export async function revokeLaundryMember(partnerId: string, userId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("laundry_member_revoke", { org: ctx.org!.id, partner: partnerId, member: userId });
  if (e) return fail(code(e));
  refresh();
  return { ok: true, data: undefined };
}

export async function createLaundryOrder(input: { partnerId: string; lines: { itemId: string; qty: number }[]; expectedBackAt: string; note: string }): Promise<Result<{ id: string; reference: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const lines = input.lines.filter((l) => Number.isInteger(l.qty) && l.qty > 0).map((l) => ({ item: l.itemId, qty: l.qty }));
  if (!lines.length) return fail("no_lines");
  const { data, error: e } = await ctx.supabase.rpc("laundry_order_create", { org: ctx.org!.id, partner: input.partnerId, lines, back_at: input.expectedBackAt, p_note: input.note || null });
  if (e) return fail(code(e, ["insufficient_stock", "invalid_date"]));
  refresh();
  const d = data as { id: string; reference: string };
  return { ok: true, data: { id: d.id, reference: d.reference } };
}

export async function cancelLaundryOrder(orderId: string, reason: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("laundry_order_cancel", { org: ctx.org!.id, oid: orderId, reason });
  if (e) return fail(code(e, ["reason_required"]));
  if ((data as { status: string }).status === "stale") return fail("laundry_stale");
  refresh();
  return { ok: true, data: undefined };
}

/** Réception constatée par la conciergerie (quantités réellement reçues) ; renvoie le nombre d'écarts. */
export async function confirmLaundryOrder(orderId: string, lines: { itemId: string; qty: number }[], note: string): Promise<Result<{ gaps: number }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("laundry_order_confirm", { org: ctx.org!.id, oid: orderId, lines: lines.map((l) => ({ item: l.itemId, qty: l.qty })), p_note: note || null });
  if (e) return fail(code(e, ["insufficient_stock"]));
  const d = data as { status: string; gaps?: unknown[] };
  if (d.status === "stale") return fail("laundry_stale");
  refresh();
  return { ok: true, data: { gaps: d.gaps?.length ?? 0 } };
}

// ---------------------------------------------------------------- Blanchisseur

export async function acceptLaundryInvite(token: string): Promise<Result<{ status: string; email?: string }>> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  const { data, error: e } = await ctx.supabase.rpc("laundry_accept_invite", { raw_token: token });
  if (e) return fail(code(e));
  const d = data as { status: string; email?: string };
  if (d.status === "ok") refresh();
  return { ok: true, data: d };
}

/** Étape suivante d'une commande, avec les quantités déclarées à la réception et au départ en livraison. */
export async function advanceLaundryOrder(orderId: string, toStatus: string, lines: { itemId: string; qty: number }[] | null, note: string): Promise<Result<{ gaps: number }>> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  const { data, error: e } = await ctx.supabase.rpc("laundry_order_advance", { oid: orderId, to_status: toStatus, lines: lines ? lines.map((l) => ({ item: l.itemId, qty: l.qty })) : null, p_note: note || null });
  if (e) return fail(code(e));
  const d = data as { status: string; gaps?: unknown[] };
  if (d.status === "stale") return fail("laundry_stale");
  // Écart déclaré : la notification préparée pour les responsables part tout de suite (e-mail / push selon leurs choix)
  if (d.gaps?.length) await processOutbox();
  refresh();
  return { ok: true, data: { gaps: d.gaps?.length ?? 0 } };
}
