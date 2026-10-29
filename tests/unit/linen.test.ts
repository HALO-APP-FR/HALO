import { describe, expect, it } from "vitest";
import { DEFAULT_LINEN } from "@/lib/domain/linen-catalog";
import type { LaundryOrder, LinenMovement, LinenType, Property } from "@/lib/domain/types";
import {
  forecastLinen,
  kitCost,
  kitFor,
  laundryDiscrepancies,
  laundryReceiveMovements,
  laundryReturns,
  laundrySendMovements,
  parLevelTarget,
  qtyAt,
  stockFromMovements,
  suggestLaundryLines,
  turnoverMovements,
} from "@/lib/engine/linen";
import { expectedTasks, PET_EXTRA_MIN } from "@/lib/engine/tasks";

const types: LinenType[] = DEFAULT_LINEN.map((t, i) => ({ ...t, id: t.key!, name: t.key! ?? String(i) }));
let n = 0;
const id = () => `m${++n}`;
const NOW = "2026-11-01T10:00:00.000Z";

describe("kit de linge", () => {
  it("lit double + 2 lits simples, 4 voyageurs, 1 bébé", () => {
    const kit = kitFor([{ id: "a", size: "double" }, { id: "b", size: "single" }, { id: "c", size: "single" }], types, 4, 1);
    const q = (k: string) => kit.find((l) => l.linenTypeId === k)?.qty ?? 0;
    expect(q("fitted_140")).toBe(1);
    expect(q("fitted_90")).toBe(2);
    expect(q("duvet_240")).toBe(1);
    expect(q("duvet_140")).toBe(2);
    expect(q("pillowcase")).toBe(4); // 2 (double) + 1 + 1
    expect(q("bath_towel")).toBe(4);
    expect(q("hand_towel")).toBe(4);
    expect(q("bath_mat")).toBe(1);
    expect(q("tea_towel")).toBe(2);
    expect(q("cot_sheet")).toBe(1);
  });
  it("coût d'une rotation", () => {
    const kit = kitFor([{ id: "a", size: "double" }], types, 2, 0);
    // 1.4 + 2.4 + 2×0.5 + 2×0.9 + 2×0.5 + 0.6 + 2×0.3
    expect(kitCost(kit, types)).toBeCloseTo(8.8, 5);
  });
});

describe("stock par emplacement", () => {
  const purchase: LinenMovement[] = [
    { id: "p1", linenTypeId: "bath_towel", to: "clean", qty: 20, reason: "purchase", createdAt: NOW },
    { id: "p2", linenTypeId: "bath_mat", to: "clean", qty: 5, reason: "purchase", createdAt: NOW },
  ];

  it("ménage : le linge sale part, le kit neuf est posé", () => {
    let mv = [...purchase];
    const kit = [{ linenTypeId: "bath_towel", qty: 2 }, { linenTypeId: "bath_mat", qty: 1 }];
    mv = mv.concat(turnoverMovements({ id: "t1", propertyId: "p" }, kit, stockFromMovements(mv), NOW, id));
    let stock = stockFromMovements(mv);
    expect(qtyAt(stock, "clean", "bath_towel")).toBe(18);
    expect(qtyAt(stock, "property:p", "bath_towel")).toBe(2);
    expect(qtyAt(stock, "dirty", "bath_towel")).toBe(0);
    // Rotation suivante : les 2 serviettes posées passent au sale
    mv = mv.concat(turnoverMovements({ id: "t2", propertyId: "p" }, kit, stock, NOW, id));
    stock = stockFromMovements(mv);
    expect(qtyAt(stock, "dirty", "bath_towel")).toBe(2);
    expect(qtyAt(stock, "property:p", "bath_towel")).toBe(2);
    expect(qtyAt(stock, "clean", "bath_towel")).toBe(16);
  });

  it("blanchisserie : envoi, réception partielle, pièces perdues et abîmées", () => {
    let mv: LinenMovement[] = [{ id: "d", linenTypeId: "bath_towel", to: "dirty", qty: 10, reason: "adjustment", createdAt: NOW }];
    const lines = suggestLaundryLines(stockFromMovements(mv), types);
    expect(lines).toEqual([{ linenTypeId: "bath_towel", sent: 10 }]);
    const order: LaundryOrder = { id: "o1", reference: "B-1", status: "sent", lines, createdAt: NOW };
    mv = mv.concat(laundrySendMovements(order, NOW, id));
    expect(qtyAt(stockFromMovements(mv), "laundry", "bath_towel")).toBe(10);
    const received: LaundryOrder = { ...order, status: "received", lines: [{ linenTypeId: "bath_towel", sent: 10, received: 7, damaged: 1 }] };
    mv = mv.concat(laundryReceiveMovements(received, NOW, id));
    const stock = stockFromMovements(mv);
    expect(qtyAt(stock, "clean", "bath_towel")).toBe(7);
    expect(qtyAt(stock, "laundry", "bath_towel")).toBe(0);
    expect(laundryDiscrepancies(received)).toEqual([{ linenTypeId: "bath_towel", lost: 2, damaged: 1 }]);
  });
});

describe("prévision", () => {
  const stock = stockFromMovements([
    { id: "a", linenTypeId: "bath_towel", to: "clean", qty: 5, reason: "purchase", createdAt: NOW },
    { id: "b", linenTypeId: "bath_towel", to: "laundry", qty: 4, reason: "laundry_send", createdAt: NOW },
  ]);
  const kit = [{ linenTypeId: "bath_towel", qty: 3 }];
  const tasks = [
    { dayKey: "2026-11-01", start: "2026-11-01T10:00:00.000Z", kit },
    { dayKey: "2026-11-02", start: "2026-11-02T10:00:00.000Z", kit },
    { dayKey: "2026-11-04", start: "2026-11-04T10:00:00.000Z", kit },
  ];
  const ret = (at: string, qty: number, late = false) => ({ linenTypeId: "bath_towel", qty, at, dayKey: at.slice(0, 10), late });

  it("un retour n'est disponible que pour les ménages qui commencent après lui", () => {
    const rows = forecastLinen({ tasks, types, stock, todayKey: "2026-11-01", days: 7, returns: [ret("2026-11-03T09:00:00.000Z", 4)] });
    const row = rows.find((r) => r.linenTypeId === "bath_towel")!;
    expect(row.need).toBe(9);
    expect(row.shortageDay).toBe("2026-11-02"); // 6 nécessaires, 5 propres : le retour du 3 arrive trop tard
    expect(row.needAtShortage).toBe(6);
    expect(row.availableAtShortage).toBe(5);
    expect(row.available).toBe(9);
    expect(row.gap).toBe(0); // manque temporaire, résorbé en fin de période
  });
  it("le même jour mais après le début du ménage : pas compté", () => {
    const rows = forecastLinen({ tasks, types, stock, todayKey: "2026-11-01", days: 7, returns: [ret("2026-11-02T15:00:00.000Z", 4)] });
    expect(rows[0].shortageDay).toBe("2026-11-02");
    const ok = forecastLinen({ tasks, types, stock, todayKey: "2026-11-01", days: 7, returns: [ret("2026-11-02T08:00:00.000Z", 4)] });
    expect(ok[0].shortageDay).toBeUndefined();
  });
  it("chaque bon garde sa propre date de retour", () => {
    const rows = forecastLinen({
      tasks,
      types,
      stock,
      todayKey: "2026-11-01",
      days: 7,
      returns: [ret("2026-11-02T08:00:00.000Z", 1), ret("2026-11-06T08:00:00.000Z", 3)],
    });
    const row = rows[0];
    expect(row.shortageDay).toBe("2026-11-04"); // 9 > 5 + 1 (le second bon revient le 6)
    expect(row.returns).toEqual([
      { dayKey: "2026-11-02", qty: 1, late: false },
      { dayKey: "2026-11-06", qty: 3, late: false },
    ]);
  });
  it("un retour en retard n'est pas compté comme disponible", () => {
    const rows = forecastLinen({ tasks, types, stock, todayKey: "2026-11-01", days: 7, returns: [ret("2026-10-30T08:00:00.000Z", 4, true)] });
    expect(rows[0].incoming).toBe(0);
    expect(rows[0].gap).toBe(-4);
    expect(rows[0].returns[0].late).toBe(true);
  });
  it("laundryReturns : une ligne par article et par bon envoyé, retard détecté", () => {
    const orders: LaundryOrder[] = [
      { id: "o1", reference: "B-1", status: "sent", lines: [{ linenTypeId: "bath_towel", sent: 4 }], createdAt: NOW, expectedAt: "2026-10-31T10:00:00.000Z" },
      { id: "o2", reference: "B-2", status: "draft", lines: [{ linenTypeId: "bath_towel", sent: 9 }], createdAt: NOW },
    ];
    const r = laundryReturns(orders, new Date(NOW), (iso) => iso.slice(0, 10));
    expect(r).toEqual([{ linenTypeId: "bath_towel", qty: 4, at: "2026-10-31T10:00:00.000Z", dayKey: "2026-10-31", late: true }]);
  });
  it("un ménage ne pose jamais plus de linge que le stock propre", () => {
    const small = stockFromMovements([{ id: "a", linenTypeId: "bath_towel", to: "clean", qty: 2, reason: "purchase", createdAt: NOW }]);
    const mvs = turnoverMovements({ id: "t", propertyId: "p" }, [{ linenTypeId: "bath_towel", qty: 4 }], small, NOW, id);
    const after = stockFromMovements([{ id: "a", linenTypeId: "bath_towel", to: "clean", qty: 2, reason: "purchase", createdAt: NOW }, ...mvs]);
    expect(qtyAt(after, "clean", "bath_towel")).toBe(0);
    expect(qtyAt(after, "property:p", "bath_towel")).toBe(2);
  });
});

describe("niveau de stock et voyageurs", () => {
  const prop = { id: "p", beds: [{ id: "a", size: "double" }], capacity: 2, linenParLevel: 3, archived: false } as unknown as Property;
  it("stock cible = kit × 3 rotations", () => {
    expect(parLevelTarget([prop], types, "bath_towel")).toBe(6);
  });
  it("animaux : ménage rallongé ; bébé : remonté sur la tâche suivante", () => {
    const p = { ...prop, timezone: "Europe/Paris", cleaningDurationMin: 120, checkInService: false, checkOutService: false } as Property;
    const drafts = expectedTasks(
      p,
      [
        { id: "r1", propertyId: "p", source: "manual", checkInAt: "2026-11-02T15:00:00Z", checkOutAt: "2026-11-05T10:00:00Z", status: "confirmed", pets: 1 },
        { id: "r2", propertyId: "p", source: "manual", checkInAt: "2026-11-05T15:00:00Z", checkOutAt: "2026-11-07T10:00:00Z", status: "confirmed", guestsCount: 2, babies: 1 },
      ],
      new Date("2026-11-01T00:00:00Z"),
    );
    const t1 = drafts.find((d) => d.reservationId === "r1")!;
    expect(t1.durationMin).toBe(120 + PET_EXTRA_MIN);
    expect(t1.pets).toBe(1);
    expect(t1.babies).toBe(1);
  });
});

describe("départ anticipé", () => {
  it("« Je pars » avance le début de la fenêtre de ménage", () => {
    const p = { id: "p", beds: [], capacity: 2, timezone: "Europe/Paris", cleaningDurationMin: 120, checkInService: false, checkOutService: false } as unknown as Property;
    const drafts = expectedTasks(
      p,
      [{ id: "r1", propertyId: "p", source: "manual", checkInAt: "2026-11-02T15:00:00Z", checkOutAt: "2026-11-05T10:00:00Z", departedAt: "2026-11-05T08:10:00Z", status: "confirmed" }],
      new Date("2026-11-01T00:00:00Z"),
    );
    expect(drafts[0].windowStart).toBe("2026-11-05T08:10:00.000Z");
  });
});

describe("prévision de linge : cas réaliste d'un week-end chargé", () => {
  // 3 rotations le vendredi, 4 le samedi ; 5 draps doubles et 12 serviettes propres ;
  // le linge sale du vendredi revient de la blanchisserie le dimanche matin (48 h).
  const kit = [
    { linenTypeId: "fitted_140", qty: 1 },
    { linenTypeId: "bath_towel", qty: 2 },
  ];
  const turnover = (day: string, hour: number) => ({ dayKey: day, start: `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`, kit });
  const tasks = [
    turnover("2026-11-06", 10), turnover("2026-11-06", 11), turnover("2026-11-06", 13),
    turnover("2026-11-07", 9), turnover("2026-11-07", 10), turnover("2026-11-07", 12), turnover("2026-11-07", 14),
  ];
  const stock = new Map([["clean", new Map([["fitted_140", 5], ["bath_towel", 12]])]]) as Parameters<typeof forecastLinen>[0]["stock"];
  const returns = [
    { linenTypeId: "fitted_140", qty: 3, at: "2026-11-08T08:00:00.000Z", dayKey: "2026-11-08", late: false },
    { linenTypeId: "bath_towel", qty: 6, at: "2026-11-08T08:00:00.000Z", dayKey: "2026-11-08", late: false },
  ];
  const rows = forecastLinen({ tasks, types, stock, todayKey: "2026-11-06", days: 3, returns });
  const sheet = rows.find((r) => r.linenTypeId === "fitted_140")!;
  const towel = rows.find((r) => r.linenTypeId === "bath_towel")!;

  it("le manque est daté au samedi, à la 6e rotation, même si le retour du dimanche couvre la fin de période", () => {
    expect(sheet).toMatchObject({ need: 7, clean: 5, incoming: 3, available: 8, gap: 1, shortageDay: "2026-11-07", needAtShortage: 6, availableAtShortage: 5 });
  });
  it("serviettes : manque à la 7e rotation (14 nécessaires pour 12)", () => {
    expect(towel).toMatchObject({ need: 14, shortageDay: "2026-11-07", needAtShortage: 14, availableAtShortage: 12, gap: 4 });
  });
  it("un retour prévu avant les rotations du samedi supprime le manque", () => {
    const early = returns.map((r) => ({ ...r, at: "2026-11-07T07:00:00.000Z", dayKey: "2026-11-07" }));
    const ok = forecastLinen({ tasks, types, stock, todayKey: "2026-11-06", days: 3, returns: early });
    expect(ok.find((r) => r.linenTypeId === "fitted_140")!.shortageDay).toBeUndefined();
    expect(ok.find((r) => r.linenTypeId === "bath_towel")!.shortageDay).toBeUndefined();
  });
});
