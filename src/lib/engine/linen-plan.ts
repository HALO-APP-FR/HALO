/**
 * Besoins de linge à venir et alertes — calcul pur, à partir des données réelles :
 * séjours confirmés (arrivées), kit défini par logement, stock compté par emplacement.
 *
 * Règle d'honnêteté : sans catalogue, sans inventaire d'un article ou sans kit pour un logement qui reçoit
 * un voyageur, HALO ne conclut jamais que « tout est prêt » : il dit ce qui manque pour pouvoir calculer.
 */
export type LinenLocation = "clean" | "dirty" | "laundry";
export interface LinenItem {
  id: string;
  label: string;
  unit: string;
}
export interface LinenKit {
  propertyId: string;
  itemId: string;
  qty: number;
}
export interface LinenStockRow {
  itemId: string;
  location: LinenLocation;
  qty: number;
  lastCountAt: string | null;
}
export interface LinenArrival {
  stayId: string;
  propertyId: string;
  propertyName: string;
  checkInAt: string;
}

/** Linge attendu en retour du blanchisseur (commandes en cours, date de retour prévue encore à venir) */
export interface LinenReturn {
  itemId: string;
  qty: number;
  at: string;
}

export type LinenAlert =
  | { kind: "no_items" }
  | { kind: "no_stock"; itemId: string }
  | { kind: "no_kit"; propertyId: string; propertyName: string; firstArrivalAt: string; arrivals: number }
  | { kind: "shortage"; itemId: string; need: number; available: number; at: string; propertyName: string; stayId: string; /** Dont retours du blanchisseur attendus avant cette arrivée */ fromLaundry: number; /** Arrivées concernées (cette arrivée et les suivantes de la période) */ arrivals: number };

export interface LinenNeed {
  itemId: string;
  /** Besoin cumulé des arrivées de la période (logements avec kit uniquement) */
  need: number;
  clean: number;
  dirty: number;
  laundry: number;
  /** Au moins un inventaire enregistré pour cet article */
  counted: boolean;
  lastCountAt: string | null;
}

export interface LinenPlan {
  needs: LinenNeed[];
  alerts: LinenAlert[];
  /** Toutes les données nécessaires sont là (catalogue, inventaires, kits) : seul cas où l'absence d'alerte a un sens */
  complete: boolean;
  arrivalsWithoutKit: number;
}

/**
 * `returns` : retours attendus du blanchisseur. Comptés disponibles pour une arrivée seulement s'ils sont prévus AVANT
 * elle ; un retour en retard (date passée, non réceptionné) n'est jamais compté (il est signalé à part).
 */
export function linenPlan(items: LinenItem[], kits: LinenKit[], stock: LinenStockRow[], arrivals: LinenArrival[], returns: LinenReturn[] = []): LinenPlan {
  const alerts: LinenAlert[] = [];
  if (!items.length) return { needs: [], alerts: [{ kind: "no_items" }], complete: false, arrivalsWithoutKit: arrivals.length };
  const qty = (itemId: string, loc: LinenLocation) => stock.find((s) => s.itemId === itemId && s.location === loc)?.qty ?? 0;
  const lastCount = (itemId: string) =>
    stock
      .filter((s) => s.itemId === itemId && s.lastCountAt)
      .map((s) => s.lastCountAt!)
      .sort()
      .at(-1) ?? null;
  const kitOf = new Map<string, LinenKit[]>();
  for (const k of kits) kitOf.set(k.propertyId, [...(kitOf.get(k.propertyId) ?? []), k]);
  const sorted = [...arrivals].sort((a, b) => Date.parse(a.checkInAt) - Date.parse(b.checkInAt));

  // Logements sans kit : besoin inconnu (une alerte par logement, avec la première arrivée)
  const withoutKit = new Map<string, { name: string; first: string; n: number }>();
  for (const a of sorted) {
    if (kitOf.has(a.propertyId)) continue;
    const cur = withoutKit.get(a.propertyId);
    withoutKit.set(a.propertyId, { name: a.propertyName, first: cur?.first ?? a.checkInAt, n: (cur?.n ?? 0) + 1 });
  }
  for (const [propertyId, v] of withoutKit) alerts.push({ kind: "no_kit", propertyId, propertyName: v.name, firstArrivalAt: v.first, arrivals: v.n });

  const needs: LinenNeed[] = items.map((it) => {
    const counted = stock.some((s) => s.itemId === it.id && s.lastCountAt);
    const clean = qty(it.id, "clean");
    let cumulative = 0;
    let breach: LinenAlert | null = null;
    let impacted = 0;
    for (const a of sorted) {
      const k = kitOf.get(a.propertyId)?.find((x) => x.itemId === it.id);
      if (!k) continue;
      cumulative += k.qty;
      const back = returns.filter((r) => r.itemId === it.id && Date.parse(r.at) <= Date.parse(a.checkInAt)).reduce((s, r) => s + r.qty, 0);
      // Premier séjour pour lequel le stock propre (+ retours attendus avant lui) ne suffit plus : où et quand agir
      if (counted && cumulative > clean + back) {
        impacted += 1;
        if (!breach) breach = { kind: "shortage", itemId: it.id, need: cumulative, available: clean + back, at: a.checkInAt, propertyName: a.propertyName, stayId: a.stayId, fromLaundry: back, arrivals: 0 };
      }
    }
    if (!counted && cumulative > 0) alerts.push({ kind: "no_stock", itemId: it.id });
    if (breach) alerts.push({ ...breach, need: cumulative, arrivals: impacted } as LinenAlert);
    return { itemId: it.id, need: cumulative, clean, dirty: qty(it.id, "dirty"), laundry: qty(it.id, "laundry"), counted, lastCountAt: lastCount(it.id) };
  });
  // Articles jamais comptés, même sans besoin immédiat : signalés (stock non renseigné)
  for (const n of needs) if (!n.counted && n.need === 0) alerts.push({ kind: "no_stock", itemId: n.itemId });

  const order = { shortage: 0, no_kit: 1, no_stock: 2, no_items: 3 } as const;
  alerts.sort((a, b) => order[a.kind] - order[b.kind] || ("at" in a && "at" in b ? Date.parse(a.at) - Date.parse(b.at) : 0));
  const complete = needs.every((n) => n.counted) && withoutKit.size === 0;
  return { needs, alerts, complete, arrivalsWithoutKit: [...withoutKit.values()].reduce((s, v) => s + v.n, 0) };
}
