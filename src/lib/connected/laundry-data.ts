import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { LinenReturn } from "@/lib/engine/linen-plan";

/** Étapes d'une commande (« delivered » = réceptionné par la conciergerie) */
export const LAUNDRY_STEPS = ["sent", "received", "processing", "ready", "out_for_delivery", "delivered"] as const;
export type LaundryStatus = (typeof LAUNDRY_STEPS)[number] | "cancelled";

export interface LaundryLine {
  itemId: string;
  label: string;
  sent: number;
  received: number | null;
  returned: number | null;
  confirmed: number | null;
}
export interface LaundryOrder {
  id: string;
  reference: string;
  partnerId: string;
  partnerName: string;
  status: LaundryStatus;
  sentAt: string;
  expectedBackAt: string;
  deliveredAt: string | null;
  note: string | null;
  lines: LaundryLine[];
  events: { kind: string; side: "concierge" | "laundry"; at: string; note: string | null; actor: string | null }[];
  /** Date de retour dépassée sans réception confirmée */
  late: boolean;
  /** Quantité déclarée ou constatée différente de l'envoi (à n'importe quelle étape) */
  gap: boolean;
}
export interface LaundryPartner {
  id: string;
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  active: boolean;
  /** Comptes du blanchisseur : nom et adresse de l'invitation nominative acceptée */
  members: { userId: string; name: string | null; email: string | null; since: string }[];
  invites: { id: string; contactName: string; email: string; expiresAt: string }[];
}
export interface LaundryData {
  available: true;
  partners: LaundryPartner[];
  orders: LaundryOrder[];
  /** Retours attendus (commandes en cours, date à venir) : pris en compte dans les besoins */
  returns: LinenReturn[];
}

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

export function lineGap(l: Pick<LaundryLine, "sent" | "received" | "returned" | "confirmed">) {
  return [l.received, l.returned, l.confirmed].some((q) => q != null && q !== l.sent);
}

/** Données blanchisseur (migration 32). `available: false` tant que la migration n'est pas appliquée. */
export async function loadLaundry(supabase: SupabaseClient, orgId: string, now: Date): Promise<LaundryData | { available: false }> {
  const { data: partners, error } = await supabase.from("laundry_partners").select("id, name, contact_name, contact_email, active").eq("organization_id", orgId).order("name");
  if (error) return { available: false };
  const since = new Date(now.getTime() - 60 * 86_400_000).toISOString();
  const [{ data: orders }, { data: lines }, { data: events }, { data: members }, { data: invites }, { data: items }, { data: people }] = await Promise.all([
    supabase.from("laundry_orders").select("id, reference, partner_id, status, sent_at, expected_back_at, delivered_at, note").eq("organization_id", orgId).or(`status.not.in.(delivered,cancelled),sent_at.gte.${since}`).order("sent_at", { ascending: false }).limit(100),
    supabase.from("laundry_order_lines").select("order_id, item_id, qty_sent, qty_received, qty_returned, qty_confirmed").eq("organization_id", orgId),
    supabase.from("laundry_order_events").select("order_id, kind, actor_side, at, note, actor_id").eq("organization_id", orgId).order("at").order("id").limit(2000),
    supabase.from("laundry_partner_members").select("partner_id, user_id, created_at").eq("organization_id", orgId).is("revoked_at", null),
    supabase.from("laundry_invites").select("id, partner_id, contact_name, email, expires_at, accepted_at, accepted_by, revoked_at").eq("organization_id", orgId).order("created_at"),
    supabase.from("linen_items").select("id, label").eq("organization_id", orgId),
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", orgId),
  ]);
  const label = new Map((items ?? []).map((i) => [i.id as string, i.label as string]));
  const pname = new Map((partners ?? []).map((p) => [p.id as string, p.name as string]));
  const who = new Map((people ?? []).map((m: { user_id: string; profiles: unknown }) => [m.user_id, (one(m.profiles as { full_name: string } | null)?.full_name as string | undefined) ?? null]));
  const list: LaundryOrder[] = (orders ?? []).map((o) => {
    const ls = (lines ?? [])
      .filter((l) => l.order_id === o.id)
      .map((l) => ({ itemId: l.item_id as string, label: label.get(l.item_id as string) ?? "—", sent: l.qty_sent as number, received: l.qty_received as number | null, returned: l.qty_returned as number | null, confirmed: l.qty_confirmed as number | null }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const status = o.status as LaundryStatus;
    return {
      id: o.id as string,
      reference: o.reference as string,
      partnerId: o.partner_id as string,
      partnerName: pname.get(o.partner_id as string) ?? "—",
      status,
      sentAt: o.sent_at as string,
      expectedBackAt: o.expected_back_at as string,
      deliveredAt: (o.delivered_at as string | null) ?? null,
      note: (o.note as string | null) ?? null,
      lines: ls,
      events: (events ?? [])
        .filter((e) => e.order_id === o.id)
        .map((e) => ({ kind: e.kind as string, side: e.actor_side as "concierge" | "laundry", at: e.at as string, note: (e.note as string | null) ?? null, actor: e.actor_side === "concierge" && e.actor_id ? (who.get(e.actor_id as string) ?? null) : null })),
      late: status !== "delivered" && status !== "cancelled" && Date.parse(o.expected_back_at as string) < now.getTime(),
      gap: ls.some(lineGap),
    };
  });
  // Retours attendus : commandes en cours dont la date de retour est encore à venir ; quantité déclarée la plus récente
  const returns: LinenReturn[] = list
    .filter((o) => o.status !== "delivered" && o.status !== "cancelled" && !o.late)
    .flatMap((o) => o.lines.map((l) => ({ itemId: l.itemId, qty: l.returned ?? l.received ?? l.sent, at: o.expectedBackAt })));
  return {
    available: true,
    returns,
    orders: list,
    partners: (partners ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      contactName: (p.contact_name as string | null) ?? null,
      contactEmail: (p.contact_email as string | null) ?? null,
      active: p.active as boolean,
      members: (members ?? [])
        .filter((m) => m.partner_id === p.id)
        .map((m) => {
          const inv = (invites ?? []).filter((i) => i.accepted_by === m.user_id && i.partner_id === p.id).at(-1);
          return { userId: m.user_id as string, name: (inv?.contact_name as string | undefined) ?? null, email: (inv?.email as string | undefined) ?? null, since: m.created_at as string };
        }),
      invites: (invites ?? [])
        .filter((i) => i.partner_id === p.id && !i.accepted_at && !i.revoked_at && Date.parse(i.expires_at as string) > now.getTime())
        .map((i) => ({ id: i.id as string, contactName: i.contact_name as string, email: i.email as string, expiresAt: i.expires_at as string })),
    })),
  };
}
