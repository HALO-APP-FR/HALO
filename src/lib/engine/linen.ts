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
    // On ne pose que ce qui existe en stock propre : sinon la même pièce serait comptée à deux endroits
    const placed = Math.min(line.qty, Math.max(0, qtyAt(stock, "clean", line.linenTypeId)));
    if (placed > 0) {
      out.push({ id: newId(), linenTypeId: line.linenTypeId, from: "clean", to: loc, qty: placed, reason: "turnover_placed", taskId: task.id, createdAt: nowIso });
    }
  }
  return out;
}

export interface ForecastRow {
  linenTypeId: string;
  /** Besoin total des ménages de la période. */
  need: number;
  /** Stock propre aujourd'hui (jamais négatif). */
  clean: number;
  /** Sale en attente d'envoi. */
  dirty: number;
  /** Actuellement chez la blanchisserie (tous bons confondus). */
  atLaundry: number;
  /** Retours datés attendus pendant la période (hors retards). */
  incoming: number;
  /** Retours attendus, par date, pour l'affichage. */
  returns: { dayKey: string; qty: number; late: boolean }[];
  /** Propre + retours attendus dans la période. */
  available: number;
  /** Disponible − besoin en fin de période (négatif = manque). */
  gap: number;
  /** Premier jour où une mission manque de cet article (retours comptés seulement s'ils arrivent avant). */
  shortageDay?: string;
  /** Au premier manque : besoin cumulé et quantité réellement disponible à ce moment. */
  needAtShortage?: number;
  availableAtShortage?: number;
}

/** Retour de blanchisserie daté (une ligne de bon envoyé). */
export interface LaundryReturn {
  linenTypeId: string;
  qty: number;
  /** Instant prévu de retour. */
  at: string;
  dayKey: string;
  /** Date prévue dépassée sans réception : pas compté comme disponible (rien n'est revenu). */
  late: boolean;
}

/** Retours attendus depuis les bons envoyés (date prévue par bon, jamais une date commune). */
export function laundryReturns(orders: LaundryOrder[], now: Date, dayKeyOf: (iso: string) => string): LaundryReturn[] {
  const out: LaundryReturn[] = [];
  for (const o of orders) {
    if (o.status !== "sent" || !o.expectedAt) continue;
    for (const l of o.lines) {
      if (l.sent <= 0) continue;
      out.push({ linenTypeId: l.linenTypeId, qty: l.sent, at: o.expectedAt, dayKey: dayKeyOf(o.expectedAt), late: new Date(o.expectedAt) < now });
    }
  }
  return out;
}

/**
 * Prévision mission par mission, dans l'ordre chronologique : chaque ménage consomme son kit ;
 * un retour de blanchisserie n'est disponible que pour les ménages qui commencent après son heure de retour.
 * Les retours en retard ne sont pas comptés (prudence : le linge n'est pas là).
 */
export function forecastLinen(params: {
  tasks: { dayKey: string; start: string; kit: KitLine[] }[];
  types: LinenType[];
  stock: Stock;
  todayKey: string;
  days: number;
  returns: LaundryReturn[];
}): ForecastRow[] {
  const { tasks, types, stock, todayKey, days, returns } = params;
  const lastKey = addDaysToKey(todayKey, days - 1);
  const inPeriod = tasks.filter((t) => t.dayKey >= todayKey && t.dayKey <= lastKey).sort((a, b) => a.start.localeCompare(b.start));
  return types
    .filter((t) => t.active)
    .map((type) => {
      const clean = Math.max(0, qtyAt(stock, "clean", type.id));
      const dirty = Math.max(0, qtyAt(stock, "dirty", type.id));
      const atLaundry = Math.max(0, qtyAt(stock, "laundry", type.id));
      const mine = returns.filter((r) => r.linenTypeId === type.id);
      const usable = mine.filter((r) => !r.late && r.dayKey <= lastKey);
      const incoming = usable.reduce((n, r) => n + r.qty, 0);
      let cumulative = 0;
      let shortage: Pick<ForecastRow, "shortageDay" | "needAtShortage" | "availableAtShortage"> = {};
      for (const task of inPeriod) {
        const qty = task.kit.find((l) => l.linenTypeId === type.id)?.qty ?? 0;
        if (!qty) continue;
        cumulative += qty;
        const availableNow = clean + usable.filter((r) => r.at <= task.start).reduce((n, r) => n + r.qty, 0);
        if (!shortage.shortageDay && cumulative > availableNow) {
          shortage = { shortageDay: task.dayKey, needAtShortage: cumulative, availableAtShortage: availableNow };
        }
      }
      const byDay = new Map<string, { qty: number; late: boolean }>();
      for (const r of mine) {
        const cur = byDay.get(r.dayKey) ?? { qty: 0, late: r.late };
        byDay.set(r.dayKey, { qty: cur.qty + r.qty, late: cur.late || r.late });
      }
      const available = clean + incoming;
      return {
        linenTypeId: type.id,
        need: cumulative,
        clean,
        dirty,
        atLaundry,
        incoming,
        returns: [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dayKey, v]) => ({ dayKey, ...v })),
        available,
        gap: available - cumulative,
        ...shortage,
      };
    })
    .filter((r) => r.need > 0 || r.available > 0 || r.dirty > 0 || r.atLaundry > 0);
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
