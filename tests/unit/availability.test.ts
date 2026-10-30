import { describe, expect, it } from "vitest";
import { availabilityConflicts, freeMinutes, isAvailable, staysDuringClosures, type Absence } from "@/lib/engine/availability";

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

  it("créneau réel : une longue fenêtre qui chevauche un congé est refusée ; un horaire fixé hors congé est accepté", () => {
    const leave = abs({ startsAt: "2027-06-02T00:00:00Z", endsAt: "2027-06-03T00:00:00Z" });
    const long = { windowStart: "2027-06-01T10:00:00Z", windowEnd: "2027-06-04T10:00:00Z", durationMin: 90 };
    expect(isAvailable(ana, long, [leave])).toBe(false);
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
    expect(availabilityConflicts(tasks, [ana, leo], [abs({})], NOW)).toEqual([{ taskId: "matin", memberId: "ana", kind: "accepted", absenceIds: ["a1"] }]);
    expect(availabilityConflicts(tasks, [ana, leo], [abs({ status: "pending" })], NOW)).toEqual([{ taskId: "matin", memberId: "ana", kind: "pending", absenceIds: ["a1"] }]);
    expect(availabilityConflicts(tasks, [ana, leo], [abs({ status: "cancelled" })], NOW)).toEqual([]);
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
    expect(isAvailable({ id: "ana", position: null }, night, [leave])).toBe(false);
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
