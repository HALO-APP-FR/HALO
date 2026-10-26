/**
 * Logistique du linge — docs/04-moteur-operations.md §4. Fonctions PURES et testées.
 *
 * Emplacements : "clean" (stock propre), "dirty" (sale à envoyer), "laundry" (chez la blanchisserie),
 * "property:<id>" (posé dans un logement). Le stock n'est JAMAIS saisi directement :
 * il est toujours recalculé à partir du journal des mouvements.
 */
import type {
  Bed,
  LaundryOrder,
  LinenLocationId,
  LinenMovement,
  LinenType,
  Property,
  Task,
} from "@/lib/domain/types";
import { addDaysToKey } from "./time";

export interface KitLine {
  linenTypeId: string;
  qty: number;
}

/** Kit à poser pour une rotation : lits du logement + voyageurs (et bébés) du séjour entrant. */
export function kitFor(
  beds: Bed[],
  types: LinenType[],
  guests: number,
  babies = 0,
): KitLine[] {
  const lines: KitLine[] = [];
  for (const type of types) {
    if (!type.active) continue;
    let qty = 0;
    const r = type.rule;
    if (r.kind === "per_bed") qty = beds.reduce((sum, b) => sum + (r.qtyBySize[b.size] ?? 0), 0);
    if (r.kind === "per_guest") qty = r.qty * Math.max(guests, 0);
    if (r.kind === "per_baby") qty = r.qty * Math.max(babies, 0);
    if (r.kind === "fixed") qty = r.qty;
    if (qty > 0) lines.push({ linenTypeId: type.id, qty });
  }
  return lines;
}

/** Kit d'une tâche de ménage (voyageurs inconnus → capacité du logement). */
export function kitForTask(task: Pick<Task, "guestsCount" | "babies">, property: Property, types: LinenType[]) {
  return kitFor(property.beds, types, task.guestsCount ?? property.capacity, task.babies ?? 0);
}

export type Stock = Map<LinenLocationId, Map<string, number>>;

/** Stock par emplacement et par article, recalculé depuis le journal. */
export function stockFromMovements(movements: LinenMovement[]): Stock {
  const stock: Stock = new Map();
  const add = (loc: LinenLocationId | undefined, typeId: string, qty: number) => {
    if (!loc) return;
    const m = stock.get(loc) ?? new Map<string, number>();
    m.set(typeId, (m.get(typeId) ?? 0) + qty);
    stock.set(loc, m);
  };
  for (const mv of movements) {
    add(mv.from, mv.linenTypeId, -mv.qty);
    add(mv.to, mv.linenTypeId, mv.qty);
  }
  return stock;
}

export const qtyAt = (stock: Stock, loc: LinenLocationId, typeId: string) => stock.get(loc)?.get(typeId) ?? 0;

/** Total d'un article posé dans l'ensemble des logements. */
export function qtyInProperties(stock: Stock, typeId: string) {
  let total = 0;
  for (const [loc, m] of stock) if (loc.startsWith("property:")) total += m.get(typeId) ?? 0;
  return total;
}

/**
 * Mouvements générés à la fin d'un ménage :
 * tout le linge présent dans le logement part au sale, le kit neuf est posé depuis le stock propre.
 */
export function turnoverMovements(
  task: Pick<Task, "id" | "propertyId">,
  kit: KitLine[],
  stock: Stock,
  nowIso: string,
  newId: () => string,
): LinenMovement[] {
  const loc = `property:${task.propertyId}` as const;
  const out: LinenMovement[] = [];
  for (const [typeId, qty] of stock.get(loc) ?? []) {
    if (qty > 0) out.push({ id: newId(), linenTypeId: typeId, from: loc, to: "dirty", qty, reason: "turnover_removed", taskId: task.id, createdAt: nowIso });
  }
  for (const line of kit) {
    out.push({ id: newId(), linenTypeId: line.linenTypeId, from: "clean", to: loc, qty: line.qty, reason: "turnover_placed", taskId: task.id, createdAt: nowIso });
  }
  return out;
}

export interface ForecastRow {
  linenTypeId: string;
  need: number;
  available: number;
  gap: number; // disponible − besoin (négatif = rupture)
  /** Premier jour (AAAA-MM-JJ) où le besoin cumulé dépasse le stock propre. */
  shortageDay?: string;
  /** Quantité attendue en retour de blanchisserie pendant la période. */
  incoming: number;
}

/**
 * Prévision : besoins des ménages à venir (jour par jour) face au stock propre,
 * en comptant le linge actuellement chez la blanchisserie comme disponible au retour.
 */
export function forecastLinen(params: {
  tasks: { dayKey: string; kit: KitLine[] }[];
  types: LinenType[];
  stock: Stock;
  todayKey: string;
  days: number;
  laundryReturnKey?: string;
}): ForecastRow[] {
  const { tasks, types, stock, todayKey, days, laundryReturnKey } = params;
  const lastKey = addDaysToKey(todayKey, days - 1);
  return types
    .filter((t) => t.active)
    .map((type) => {
      const clean = qtyAt(stock, "clean", type.id);
      const atLaundry = qtyAt(stock, "laundry", type.id);
      const incoming = laundryReturnKey && laundryReturnKey <= lastKey ? atLaundry : 0;
      let cumulative = 0;
      let shortageDay: string | undefined;
      for (let i = 0; i < days; i++) {
        const day = addDaysToKey(todayKey, i);
        for (const t of tasks) {
          if (t.dayKey !== day) continue;
          cumulative += t.kit.find((l) => l.linenTypeId === type.id)?.qty ?? 0;
        }
        const availableThatDay = clean + (laundryReturnKey && day >= laundryReturnKey ? atLaundry : 0);
        if (!shortageDay && cumulative > availableThatDay) shortageDay = day;
      }
      const available = clean + incoming;
      return { linenTypeId: type.id, need: cumulative, available, gap: available - cumulative, shortageDay, incoming };
    })
    .filter((r) => r.need > 0 || r.available > 0);
}

/** Bon de blanchisserie suggéré : tout le linge sale disponible. */
export function suggestLaundryLines(stock: Stock, types: LinenType[]) {
  return types
    .map((t) => ({ linenTypeId: t.id, sent: Math.max(0, qtyAt(stock, "dirty", t.id)) }))
    .filter((l) => l.sent > 0);
}

/** Écarts d'un bon réceptionné : pièces perdues = envoyées − reçues − abîmées. */
export function laundryDiscrepancies(order: LaundryOrder) {
  return order.lines
    .map((l) => ({ linenTypeId: l.linenTypeId, lost: Math.max(0, l.sent - (l.received ?? 0) - (l.damaged ?? 0)), damaged: l.damaged ?? 0 }))
    .filter((d) => d.lost > 0 || d.damaged > 0);
}

/** Mouvements d'un bon (envoi puis réception). */
export function laundrySendMovements(order: LaundryOrder, nowIso: string, newId: () => string): LinenMovement[] {
  return order.lines
    .filter((l) => l.sent > 0)
    .map((l) => ({ id: newId(), linenTypeId: l.linenTypeId, from: "dirty", to: "laundry", qty: l.sent, reason: "laundry_send", orderId: order.id, createdAt: nowIso }));
}

export function laundryReceiveMovements(order: LaundryOrder, nowIso: string, newId: () => string): LinenMovement[] {
  const out: LinenMovement[] = [];
  for (const l of order.lines) {
    const received = Math.min(l.received ?? 0, l.sent);
    const damaged = Math.min(l.damaged ?? 0, l.sent - received);
    const lost = Math.max(0, l.sent - received - damaged);
    if (received > 0) out.push({ id: newId(), linenTypeId: l.linenTypeId, from: "laundry", to: "clean", qty: received, reason: "laundry_receive", orderId: order.id, createdAt: nowIso });
    if (damaged > 0) out.push({ id: newId(), linenTypeId: l.linenTypeId, from: "laundry", qty: damaged, reason: "damaged", orderId: order.id, createdAt: nowIso });
    if (lost > 0) out.push({ id: newId(), linenTypeId: l.linenTypeId, from: "laundry", qty: lost, reason: "lost", orderId: order.id, createdAt: nowIso });
  }
  return out;
}

/** Coût de blanchisserie d'un kit (une rotation). */
export function kitCost(kit: KitLine[], types: LinenType[]) {
  return kit.reduce((sum, l) => sum + l.qty * (types.find((t) => t.id === l.linenTypeId)?.laundryCost ?? 0), 0);
}

/**
 * Stock cible recommandé par article : kit × logements × niveau de rotation
 * (1 posé, 1 chez la blanchisserie, 1 en réserve = 3 par défaut).
 */
export function parLevelTarget(properties: Property[], types: LinenType[], typeId: string) {
  return properties
    .filter((p) => !p.archived)
    .reduce((sum, p) => {
      const kit = kitFor(p.beds, types, p.capacity, 0);
      return sum + (kit.find((l) => l.linenTypeId === typeId)?.qty ?? 0) * (p.linenParLevel || 3);
    }, 0);
}
