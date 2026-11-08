import { describe, expect, it } from "vitest";
import { linenPlan, type LinenArrival } from "@/lib/engine/linen-plan";

const items = [
  { id: "drap", label: "Drap", unit: "pièce" },
  { id: "serv", label: "Serviette", unit: "pièce" },
];
const arr = (stayId: string, propertyId: string, day: number): LinenArrival => ({ stayId, propertyId, propertyName: propertyId.toUpperCase(), checkInAt: `2026-11-${String(day).padStart(2, "0")}T15:00:00Z` });

describe("linge : besoins et alertes", () => {
  it("catalogue vide : rien n'est prêt, on le dit", () => {
    const p = linenPlan([], [], [], [arr("s1", "a", 10)]);
    expect(p.complete).toBe(false);
    expect(p.alerts).toEqual([{ kind: "no_items" }]);
  });

  it("stock jamais compté : « non renseigné », pas de faux manque ni de « tout est prêt »", () => {
    const p = linenPlan(items, [{ propertyId: "a", itemId: "drap", qty: 2 }, { propertyId: "a", itemId: "serv", qty: 4 }], [], [arr("s1", "a", 10)]);
    expect(p.complete).toBe(false);
    expect(p.alerts.filter((x) => x.kind === "no_stock")).toHaveLength(2);
    expect(p.alerts.some((x) => x.kind === "shortage")).toBe(false);
  });

  it("logement sans kit : besoin inconnu signalé, avec la première arrivée", () => {
    const stock = [{ itemId: "drap", location: "clean" as const, qty: 10, lastCountAt: "2026-11-01T08:00:00Z" }, { itemId: "serv", location: "clean" as const, qty: 10, lastCountAt: "2026-11-01T08:00:00Z" }];
    const p = linenPlan(items, [{ propertyId: "a", itemId: "drap", qty: 2 }], stock, [arr("s1", "b", 12), arr("s2", "b", 14), arr("s3", "a", 11)]);
    expect(p.complete).toBe(false);
    expect(p.alerts).toContainEqual({ kind: "no_kit", propertyId: "b", propertyName: "B", firstArrivalAt: "2026-11-12T15:00:00Z", arrivals: 2 });
  });

  it("manque potentiel : quand et où le stock propre ne suffit plus", () => {
    const stock = [
      { itemId: "drap", location: "clean" as const, qty: 3, lastCountAt: "2026-11-01T08:00:00Z" },
      { itemId: "drap", location: "laundry" as const, qty: 6, lastCountAt: null },
      { itemId: "serv", location: "clean" as const, qty: 20, lastCountAt: "2026-11-01T08:00:00Z" },
    ];
    const kits = [
      { propertyId: "a", itemId: "drap", qty: 2 },
      { propertyId: "a", itemId: "serv", qty: 4 },
      { propertyId: "b", itemId: "drap", qty: 2 },
      { propertyId: "b", itemId: "serv", qty: 4 },
    ];
    const p = linenPlan(items, kits, stock, [arr("s1", "a", 10), arr("s2", "b", 12), arr("s3", "a", 15)]);
    const s = p.alerts.find((x) => x.kind === "shortage");
    expect(s).toMatchObject({ itemId: "drap", available: 3, at: "2026-11-12T15:00:00Z", propertyName: "B", stayId: "s2", need: 6 });
    expect(p.needs.find((n) => n.itemId === "drap")).toMatchObject({ need: 6, clean: 3, laundry: 6, counted: true });
    expect(p.needs.find((n) => n.itemId === "serv")).toMatchObject({ need: 12, clean: 20 });
    expect(p.complete).toBe(true); // données complètes : le manque est fiable
  });

  it("données complètes et stock suffisant : aucune alerte", () => {
    const stock = items.map((i) => ({ itemId: i.id, location: "clean" as const, qty: 50, lastCountAt: "2026-11-01T08:00:00Z" }));
    const p = linenPlan(items, [{ propertyId: "a", itemId: "drap", qty: 2 }, { propertyId: "a", itemId: "serv", qty: 4 }], stock, [arr("s1", "a", 10)]);
    expect(p.alerts).toEqual([]);
    expect(p.complete).toBe(true);
  });
});
