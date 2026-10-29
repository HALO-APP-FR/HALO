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
