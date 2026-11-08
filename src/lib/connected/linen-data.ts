import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { linenPlan, type LinenArrival, type LinenLocation, type LinenPlan } from "@/lib/engine/linen-plan";

export interface LinenOps {
  available: true;
  items: { id: string; label: string; unit: string }[];
  kits: { propertyId: string; itemId: string; qty: number }[];
  properties: { id: string; name: string }[];
  plan: LinenPlan;
  /** Arrivées des 7 prochains jours sans livraison de linge planifiée */
  deliveriesToPlan: { stayId: string; propertyId: string; propertyName: string; guestName: string; checkInAt: string }[];
  /** Départs (veille → 7 jours) sans collecte planifiée */
  pickupsToPlan: { stayId: string; propertyId: string; propertyName: string; guestName: string; checkOutAt: string }[];
  /** Missions linge terminées pas encore reportées au stock */
  toApply: { id: string; type: string; propertyName: string; completedAt: string | null; hasKit: boolean }[];
  movements: { id: number; itemLabel: string; location: string; delta: number; kind: string; note: string | null; at: string; actor: string | null; propertyName: string | null }[];
  lastCountAt: string | null;
  linenModel: string | null;
}

const one = <T,>(v: T | T[] | null | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;

/** Données réelles du linge. `available: false` tant que la migration 26 n'est pas appliquée. */
export async function loadLinenOps(supabase: SupabaseClient, orgId: string, now: Date): Promise<LinenOps | { available: false }> {
  const { data: items, error } = await supabase.from("linen_items").select("id, label, unit").eq("organization_id", orgId).eq("active", true).order("sort").order("label");
  if (error) return { available: false };
  const in14 = new Date(now.getTime() + 14 * 86_400_000).toISOString();
  const in7 = new Date(now.getTime() + 7 * 86_400_000).getTime();
  const [{ data: kits }, { data: stock }, { data: props }, { data: arrivals }, { data: departures }, { data: linenTasks }, { data: mv }, { data: org }, { data: members }] = await Promise.all([
    supabase.from("property_linen_kits").select("property_id, item_id, qty").eq("organization_id", orgId),
    supabase.rpc("linen_stock", { org: orgId }),
    supabase.from("properties").select("id, name").eq("organization_id", orgId).is("archived_at", null).order("name"),
    supabase.from("reservations").select("id, property_id, guest_name, check_in_at, properties(name)").eq("organization_id", orgId).eq("status", "confirmed").gte("check_in_at", now.toISOString()).lt("check_in_at", in14).order("check_in_at").limit(300),
    supabase.from("reservations").select("id, property_id, guest_name, check_out_at, properties(name)").eq("organization_id", orgId).eq("status", "confirmed").gte("check_out_at", new Date(now.getTime() - 86_400_000).toISOString()).lt("check_out_at", new Date(in7).toISOString()).order("check_out_at").limit(300),
    supabase.from("tasks").select("id, type, status, property_id, reservation_id, next_reservation_id, completed_at, properties(name)").eq("organization_id", orgId).in("type", ["linen_delivery", "linen_pickup"]).neq("status", "cancelled").gte("window_end", new Date(now.getTime() - 30 * 86_400_000).toISOString()).limit(500),
    supabase.from("linen_movements").select("id, item_id, location, delta, kind, note, at, actor_id, property_id, task_id").eq("organization_id", orgId).order("id", { ascending: false }).limit(400),
    supabase.from("organizations").select("linen_model").eq("id", orgId).single(),
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", orgId),
  ]);
  const itemList = (items ?? []).map((x) => ({ id: x.id as string, label: x.label as string, unit: x.unit as string }));
  const kitList = (kits ?? []).map((k) => ({ propertyId: k.property_id as string, itemId: k.item_id as string, qty: k.qty as number }));
  const stockRows = ((stock ?? []) as { item_id: string; location: LinenLocation; qty: number; last_count_at: string | null }[])
    .filter((r) => itemList.some((i) => i.id === r.item_id))
    .map((r) => ({ itemId: r.item_id, location: r.location, qty: Number(r.qty), lastCountAt: r.last_count_at }));
  const propName = new Map((props ?? []).map((p) => [p.id as string, p.name as string]));
  const arr: LinenArrival[] = (arrivals ?? []).map((r) => ({ stayId: r.id as string, propertyId: r.property_id as string, propertyName: one(r.properties as unknown as { name: string } | null)?.name ?? propName.get(r.property_id as string) ?? "", checkInAt: r.check_in_at as string }));
  const plan = linenPlan(itemList, kitList, stockRows, arr);
  const tasks = linenTasks ?? [];
  const hasKit = new Set(kitList.map((k) => k.propertyId));
  const model = (org?.linen_model as string | null) ?? null;
  // Linge géré par HALO pour ce logement : blanchisserie déclarée, ou kit défini
  const managed = (pid: string) => model === "laundry" || model === "both" || hasKit.has(pid);
  const deliveriesToPlan = (arrivals ?? [])
    .filter((r) => Date.parse(r.check_in_at as string) < in7 && managed(r.property_id as string))
    .filter((r) => !tasks.some((k) => k.type === "linen_delivery" && k.next_reservation_id === r.id))
    .map((r) => ({ stayId: r.id as string, propertyId: r.property_id as string, propertyName: one(r.properties as unknown as { name: string } | null)?.name ?? "", guestName: (r.guest_name as string | null) ?? "", checkInAt: r.check_in_at as string }));
  const pickupsToPlan = (departures ?? [])
    .filter((r) => managed(r.property_id as string))
    .filter((r) => !tasks.some((k) => k.type === "linen_pickup" && k.reservation_id === r.id))
    .map((r) => ({ stayId: r.id as string, propertyId: r.property_id as string, propertyName: one(r.properties as unknown as { name: string } | null)?.name ?? "", guestName: (r.guest_name as string | null) ?? "", checkOutAt: r.check_out_at as string }));
  const applied = new Set((mv ?? []).map((m) => m.task_id as string | null).filter(Boolean));
  const toApply = tasks
    .filter((k) => ["done", "validated"].includes(k.status as string) && !applied.has(k.id as string))
    .map((k) => ({ id: k.id as string, type: k.type as string, propertyName: one(k.properties as unknown as { name: string } | null)?.name ?? "", completedAt: (k.completed_at as string | null) ?? null, hasKit: hasKit.has(k.property_id as string) }));
  const who = new Map((members ?? []).map((m: { user_id: string; profiles: unknown }) => [m.user_id, (one(m.profiles as { full_name: string } | null)?.full_name as string | undefined) ?? null]));
  const label = new Map(itemList.map((i) => [i.id, i.label]));
  const movements = (mv ?? []).slice(0, 30).map((m) => ({
    id: m.id as number,
    itemLabel: label.get(m.item_id as string) ?? "—",
    location: m.location as string,
    delta: m.delta as number,
    kind: m.kind as string,
    note: (m.note as string | null) ?? null,
    at: m.at as string,
    actor: m.actor_id ? (who.get(m.actor_id as string) ?? null) : null,
    propertyName: m.property_id ? (propName.get(m.property_id as string) ?? null) : null,
  }));
  const lastCountAt = stockRows.map((s) => s.lastCountAt).filter(Boolean).sort().at(-1) ?? null;
  return { available: true, items: itemList, kits: kitList, properties: (props ?? []).map((p) => ({ id: p.id as string, name: p.name as string })), plan, deliveriesToPlan, pickupsToPlan, toApply, movements, lastCountAt, linenModel: model };
}
