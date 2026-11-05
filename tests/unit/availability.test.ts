import { describe, expect, it } from "vitest";
import { absenceLevel, availabilityConflicts, conflictGroup, freeMinutes, isAvailable, staysDuringClosures, type Absence } from "@/lib/engine/availability";

const ana = { id: "ana", position: "housekeeper" };
const leo = { id: "leo", position: "maintenance" };
const abs = (over: Partial<Absence>): Absence => ({
  id: "a1", scope: "member", memberId: "ana", teamPosition: null, kind: "leave",
  startsAt: "2027-04-10T07:00:00Z", endsAt: "2027-04-10T11:00:00Z", status: "accepted", ...over,
});
const task = (id: string, start: string, end: string, assigneeId: string | null = "ana", durationMin = 120) =>
  ({ id, assigneeId, status: assigneeId ? "assigned" : "unassigned", windowStart: start, windowEnd: end, durationMin });
const NOW = new Date("2027-04-01T00:00:00Z");

describe("disponibilités (même règle que la base)", () => {
  it("absence partielle : seul le temps recouvert est retiré", () => {
    expect(freeMinutes(ana, "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", [abs({})])).toBe(60);
    expect(isAvailable(ana, task("m", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z"), [abs({})])).toBe(false);
    expect(isAvailable(ana, task("a", "2027-04-10T13:00:00Z", "2027-04-10T17:00:00Z"), [abs({})])).toBe(true);
  });

  it("migration 16 : longue fenêtre partiellement couverte = risque ; fenêtre sans temps libre suffisant = conflit ; horaire fixé = règle stricte", () => {
    const leave = abs({ startsAt: "2027-06-02T00:00:00Z", endsAt: "2027-06-03T00:00:00Z" });
    const long = { windowStart: "2027-06-01T10:00:00Z", windowEnd: "2027-06-04T10:00:00Z", durationMin: 90 };
    expect(absenceLevel(ana, long, [leave])).toMatchObject({ level: "risk", freeMin: 2040 });
    expect(isAvailable(ana, long, [leave])).toBe(true);
    expect(absenceLevel(ana, { windowStart: "2027-06-01T23:00:00Z", windowEnd: "2027-06-03T00:30:00Z", durationMin: 90 }, [leave])).toMatchObject({ level: "conflict", freeMin: 60 });
    expect(absenceLevel(ana, { windowStart: "2027-06-03T08:00:00Z", windowEnd: "2027-06-03T18:00:00Z", durationMin: 90 }, [leave]).level).toBe("none");
    expect(isAvailable(ana, { ...long, scheduledStart: "2027-06-01T12:00:00Z" }, [leave])).toBe(true);
    expect(isAvailable(ana, { ...long, scheduledStart: "2027-06-02T09:00:00Z" }, [leave])).toBe(false);
    expect(isAvailable(ana, { ...long, scheduledStart: "2027-06-01T23:00:00Z" }, [leave])).toBe(false); // 23 h + 1 h 30 déborde sur le congé
  });

  it("en attente, refusée ou annulée : ne bloque pas", () => {
    for (const status of ["pending", "refused", "cancelled"] as const) {
      expect(freeMinutes(ana, "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", [abs({ status })])).toBe(240);
    }
  });

  it("fermeture d'équipe : tout le monde ; fermeture d'un poste : ce poste seulement", () => {
    const all = abs({ scope: "team", memberId: null, kind: "closure", startsAt: "2027-04-10T00:00:00Z", endsAt: "2027-04-11T00:00:00Z" });
    expect(freeMinutes(leo, "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", [all])).toBe(0);
    const cleaners = { ...all, teamPosition: "housekeeper" };
    expect(freeMinutes(ana, "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", [cleaners])).toBe(0);
    expect(freeMinutes(leo, "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", [cleaners])).toBe(240);
  });

  it("absences qui se suivent ou se recouvrent : le plus long temps libre restant", () => {
    const list = [abs({ id: "1", startsAt: "2027-04-10T08:00:00Z", endsAt: "2027-04-10T09:00:00Z" }), abs({ id: "2", startsAt: "2027-04-10T08:30:00Z", endsAt: "2027-04-10T10:00:00Z" })];
    expect(freeMinutes(ana, "2027-04-10T08:00:00Z", "2027-04-10T13:00:00Z", list)).toBe(180);
  });

  it("fuseaux horaires : les instants sont comparés en UTC (09:00 Paris = 07:00 UTC en été)", () => {
    const paris = abs({ startsAt: "2027-07-10T09:00:00+02:00", endsAt: "2027-07-10T11:00:00+02:00" });
    expect(freeMinutes(ana, "2027-07-10T07:00:00Z", "2027-07-10T09:00:00Z", [paris])).toBe(0);
  });

  it("conflits : missions attribuées à réorganiser, jamais réaffectées", () => {
    const tasks = [
      task("matin", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z"),
      task("aprem", "2027-04-10T13:00:00Z", "2027-04-10T17:00:00Z"),
      task("libre", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", null),
    ];
    expect(availabilityConflicts(tasks, [ana, leo], [abs({})], NOW)).toMatchObject([{ taskId: "matin", memberId: "ana", kind: "accepted", absenceIds: ["a1"] }]);
    expect(availabilityConflicts(tasks, [ana, leo], [abs({ status: "pending" })], NOW)).toEqual([{ taskId: "matin", memberId: "ana", kind: "pending", absenceIds: ["a1"] }]);
    expect(availabilityConflicts(tasks, [ana, leo], [abs({ status: "cancelled" })], NOW)).toEqual([]);
  });

  it("retour du 5/11 : une demande en attente n'est jamais un conflit confirmé (en attente / acceptée / refusée / annulée)", () => {
    const tasks = [task("matin", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z")];
    const group = (status: Absence["status"]) => availabilityConflicts(tasks, [ana], [abs({ status })], NOW).map((c) => conflictGroup(c.kind));
    expect(group("pending")).toEqual(["potential"]);
    expect(group("accepted")).toEqual(["confirmed"]);
    expect(group("refused")).toEqual([]);
    expect(group("cancelled")).toEqual([]);
    // Absence acceptée sur une partie d'une longue fenêtre : à examiner, pas confirmée
    const long = [task("long", "2027-04-09T08:00:00Z", "2027-04-12T08:00:00Z")];
    expect(availabilityConflicts(long, [ana], [abs({})], NOW).map((c) => conflictGroup(c.kind))).toEqual(["review"]);
    // Fermeture d'équipe acceptée : confirmée
    expect(conflictGroup("closure")).toBe("confirmed");
  });

  it("mission en cours : absence à venir dans la fenêtre ≠ absence déjà commencée", () => {
    const run = { id: "run", assigneeId: "ana", status: "in_progress", windowStart: "2026-11-01T08:00:00Z", windowEnd: "2026-11-05T18:00:00Z", durationMin: 90 };
    const day3 = abs({ startsAt: "2026-11-03T00:00:00Z", endsAt: "2026-11-04T00:00:00Z" });
    const [c] = availabilityConflicts([run], [ana], [day3], new Date("2026-11-02T10:00:00Z"));
    expect(c).toMatchObject({ kind: "started_upcoming", absenceStart: "2026-11-03T00:00:00Z" });
    expect(availabilityConflicts([run], [ana], [day3], new Date("2026-11-03T10:00:00Z"))[0].kind).toBe("started");
  });

  it("brief du 3/11 : mission en cours — démarrée pendant l'absence, avant une absence commencée depuis, avant une absence à venir", () => {
    const base = { id: "run", assigneeId: "ana", status: "in_progress", windowStart: "2026-11-01T08:00:00Z", windowEnd: "2026-11-05T18:00:00Z", durationMin: 90 };
    const day4 = abs({ startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" });
    // Démarrée le 2, absence le 4 : à venir le 3, commencée le 4 (démarrage AVANT l'absence)
    expect(availabilityConflicts([{ ...base, startedAt: "2026-11-02T09:00:00Z" }], [ana], [day4], new Date("2026-11-03T10:00:00Z"))[0].kind).toBe("started_upcoming");
    expect(availabilityConflicts([{ ...base, startedAt: "2026-11-02T09:00:00Z" }], [ana], [day4], new Date("2026-11-04T10:00:00Z"))[0]).toMatchObject({ kind: "started_before", startedAt: "2026-11-02T09:00:00Z" });
    // Démarrée le 4 à 9 h, pendant l'absence
    expect(availabilityConflicts([{ ...base, startedAt: "2026-11-04T09:00:00Z" }], [ana], [day4], new Date("2026-11-04T10:00:00Z"))[0].kind).toBe("started_during");
    // Heure de démarrage inconnue : on ne prétend pas savoir
    expect(availabilityConflicts([base], [ana], [day4], new Date("2026-11-04T10:00:00Z"))[0].kind).toBe("started");
  });

  it("brief du 3/11 : temps libre calculé à partir de maintenant quand la fenêtre a commencé (période indiquée)", () => {
    const t1 = { id: "w", assigneeId: "ana", status: "assigned", windowStart: "2026-11-01T08:00:00Z", windowEnd: "2026-11-05T18:00:00Z", durationMin: 90 };
    const day4 = abs({ startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" });
    const [c] = availabilityConflicts([t1], [ana], [day4], new Date("2026-11-03T12:00:00Z"));
    // De maintenant (3/11 12:00) à l'absence (4/11 00:00) : 12 h ; après l'absence : 18 h → 18 h (1080 min), et non les 64 h passées
    expect(c).toMatchObject({ kind: "partial", freeMin: 1080, period: { from: "2026-11-03T12:00:00.000Z", to: "2026-11-05T18:00:00Z", fromNow: true } });
    // Avant le début de la fenêtre : fenêtre entière
    const [c0] = availabilityConflicts([t1], [ana], [day4], new Date("2026-10-30T00:00:00Z"));
    expect(c0.period).toMatchObject({ fromNow: false, from: "2026-11-01T08:00:00Z" });
  });

  it("brief du 3/11 : absence sur toute la fenêtre restante = conflit ; plusieurs absences ; absence annulée ignorée", () => {
    const t1 = { id: "w", assigneeId: "ana", status: "assigned", windowStart: "2026-11-01T08:00:00Z", windowEnd: "2026-11-05T18:00:00Z", durationMin: 90 };
    const all = abs({ startsAt: "2026-11-01T00:00:00Z", endsAt: "2026-11-06T00:00:00Z" });
    expect(availabilityConflicts([t1], [ana], [all], new Date("2026-11-03T12:00:00Z"))[0]).toMatchObject({ kind: "accepted", freeMin: 0 });
    // Le temps libre restant devient trop court à partir de maintenant : conflit, même si la fenêtre entière en avait eu assez
    const two = [abs({ id: "x", startsAt: "2026-11-03T12:30:00Z", endsAt: "2026-11-05T17:30:00Z" })];
    expect(availabilityConflicts([t1], [ana], two, new Date("2026-11-03T12:00:00Z"))[0]).toMatchObject({ kind: "accepted", freeMin: 30 });
    expect(availabilityConflicts([t1], [ana], [abs({ ...all, status: "cancelled" })], new Date("2026-11-03T12:00:00Z"))).toEqual([]);
    // Horaire planifié chevauché : conflit certain, sans calcul de temps libre
    expect(availabilityConflicts([{ ...t1, scheduledStart: "2026-11-04T09:00:00Z" }], [ana], [abs({ startsAt: "2026-11-04T00:00:00Z", endsAt: "2026-11-05T00:00:00Z" })], new Date("2026-11-03T12:00:00Z"))[0]).toMatchObject({ kind: "accepted", freeMin: null });
  });

  it("fermeture : missions attribuées ou non, séjours concernés signalés", () => {
    const closure = abs({ id: "f", scope: "team", memberId: null, kind: "closure", startsAt: "2027-04-10T00:00:00Z", endsAt: "2027-04-11T00:00:00Z" });
    const tasks = [task("matin", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z"), task("libre", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z", null)];
    expect(availabilityConflicts(tasks, [ana], [closure], NOW).map((c) => [c.taskId, c.kind])).toEqual([["matin", "closure"], ["libre", "closure"]]);
    const stays = [{ id: "s1", checkInAt: "2027-04-10T15:00:00Z", checkOutAt: "2027-04-12T10:00:00Z" }, { id: "s2", checkInAt: "2027-04-12T15:00:00Z", checkOutAt: "2027-04-14T10:00:00Z" }];
    expect(staysDuringClosures(stays, [closure]).map((s) => s.id)).toEqual(["s1"]);
  });

  it("missions terminées ou passées : ignorées", () => {
    const done = { ...task("x", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z"), status: "validated" };
    expect(availabilityConflicts([done], [ana], [abs({})], NOW)).toEqual([]);
    expect(availabilityConflicts([task("y", "2027-04-10T08:00:00Z", "2027-04-10T12:00:00Z")], [ana], [abs({})], new Date("2027-05-01T00:00:00Z"))).toEqual([]);
  });
});

import { nextDay, zonedMidnight } from "@/lib/connected/format";
describe("journées entières dans le fuseau de l'organisation", () => {
  it("minuit à Paris, hiver et été", () => {
    expect(zonedMidnight("2027-01-15", "Europe/Paris").toISOString()).toBe("2027-01-14T23:00:00.000Z");
    expect(zonedMidnight("2027-07-15", "Europe/Paris").toISOString()).toBe("2027-07-14T22:00:00.000Z");
  });
  it("jour du changement d'heure et autres fuseaux", () => {
    expect(zonedMidnight("2027-03-28", "Europe/Paris").toISOString()).toBe("2027-03-27T23:00:00.000Z");
    expect(zonedMidnight("2027-03-29", "Europe/Paris").toISOString()).toBe("2027-03-28T22:00:00.000Z");
    expect(zonedMidnight("2027-01-15", "America/New_York").toISOString()).toBe("2027-01-15T05:00:00.000Z");
    expect(zonedMidnight("2027-01-15", "Asia/Tokyo").toISOString()).toBe("2027-01-14T15:00:00.000Z");
  });
  it("une mission qui traverse minuit chevauche bien le jour d'absence suivant", () => {
    const leave = { id: "a", scope: "member" as const, memberId: "ana", teamPosition: null, kind: "leave" as const, status: "accepted" as const,
      startsAt: zonedMidnight("2027-02-02", "Europe/Paris").toISOString(), endsAt: zonedMidnight(nextDay("2027-02-02"), "Europe/Paris").toISOString() };
    const night = { windowStart: "2027-02-01T21:00:00Z", windowEnd: "2027-02-02T01:00:00Z", durationMin: 60 }; // 22 h → 2 h (Paris)
    // 22 h → minuit reste libre (2 h ≥ 1 h) : risque à examiner, pas conflit ; la base applique la même règle
    expect(absenceLevel({ id: "ana", position: null }, night, [leave])).toMatchObject({ level: "risk", freeMin: 120 });
    expect(absenceLevel({ id: "ana", position: null }, { ...night, durationMin: 150 }, [leave]).level).toBe("conflict");
    expect(isAvailable({ id: "ana", position: null }, { ...night, scheduledStart: "2027-02-01T21:00:00Z" }, [leave])).toBe(true); // 22 h → 23 h : avant minuit
    expect(nextDay("2027-12-31")).toBe("2028-01-01");
  });
});

import { createFormatter } from "next-intl";
import { windowText, zoneLabel } from "@/lib/connected/format";
describe("affichage des heures : fuseau du logement, changement d'heure, minuit", () => {
  const f = createFormatter({ locale: "fr", timeZone: "Europe/Paris" });
  it("même instant, fuseau du logement (Tokyo) et fuseau de l'organisation (Paris)", () => {
    const s = "2027-01-10T02:00:00Z";
    const e = "2027-01-10T05:00:00Z";
    expect(windowText(f, s, e)).toBe("10 janv. 2027, 03:00 → 06:00");
    expect(windowText(f, s, e, false, "Asia/Tokyo")).toBe("10 janv. 2027, 11:00 → 14:00");
    expect(zoneLabel("Asia/Tokyo", new Date(s))).toBe("Tokyo, UTC+9");
    expect(zoneLabel("Europe/Paris", new Date(s))).toBeNull();
  });
  it("changement d'heure (passage à l'heure d'été à Paris le 28 mars 2027)", () => {
    // 00:30 UTC = 01:30 (heure d'hiver) ; 03:30 UTC = 05:30 (heure d'été) : 3 h réelles, affichées sans erreur
    expect(windowText(f, "2027-03-28T00:30:00Z", "2027-03-28T03:30:00Z")).toBe("28 mars 2027, 01:30 → 05:30");
  });
  it("mission qui traverse minuit : la date de fin est affichée", () => {
    expect(windowText(f, "2027-02-01T21:00:00Z", "2027-02-02T01:00:00Z")).toBe("1 févr. 2027, 22:00 → 2 févr. 2027, 02:00");
  });
});
