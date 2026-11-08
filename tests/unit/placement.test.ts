import { describe, expect, it } from "vitest";
import { clip, occupies, placement } from "@/lib/engine/placement";
import { dayKey, dayRange } from "@/lib/connected/days";

const PARIS = "Europe/Paris";
const day = (key: string, tz = PARIS) => {
  const { start, end } = dayRange(key, 1, tz);
  return [start.getTime(), end.getTime()] as const;
};
const now = Date.parse("2026-11-06T15:00:00Z");

/** Ancienne règle du planning (avant correction) : reproduite pour prouver les deux anomalies constatées. */
function oldRule(k: { window_start: string; window_end: string; scheduled_start: string | null; duration_min: number }, key: string) {
  const [s, e] = day(key);
  const anchor = Date.parse(k.scheduled_start ?? k.window_start);
  const shown = Date.parse(k.window_start) < e && Date.parse(k.window_end) >= s;
  return { shown, start: anchor, end: anchor + k.duration_min * 60_000 };
}

describe("placement des missions", () => {
  // QA Carte : plage 10:41–16:00 (Paris), 1 h 30, aucun horaire planifié
  const qa = { status: "assigned", window_start: "2026-11-06T09:41:00Z", window_end: "2026-11-06T15:00:00Z", duration_min: 90, scheduled_start: null };

  it("reproduit l'ancienne anomalie : créneau 10:41–12:11 inventé à partir de la plage", () => {
    const o = oldRule(qa, "2026-11-06");
    expect(o.shown).toBe(true);
    expect(new Date(o.start).toISOString()).toBe("2026-11-06T09:41:00.000Z");
    expect(new Date(o.end).toISOString()).toBe("2026-11-06T11:11:00.000Z");
  });

  it("mission sans créneau : « à planifier », jamais un horaire", () => {
    const p = placement(qa, now);
    expect(p.kind).toBe("unscheduled");
    expect(occupies(p, ...day("2026-11-06"))).toBe(true);
    expect(occupies(p, ...day("2026-11-05"))).toBe(false);
  });

  it("créneau confirmé : placé sur le créneau, avec la durée estimée", () => {
    const p = placement({ ...qa, scheduled_start: "2026-11-06T13:00:00Z" }, now);
    expect(p).toEqual({ kind: "scheduled", start: Date.parse("2026-11-06T13:00:00Z"), end: Date.parse("2026-11-06T14:30:00Z") });
  });

  it("reproduit l'ancienne anomalie : mission du 5 affichée le 6 (plage qui se termine le 6)", () => {
    const k = { status: "assigned", window_start: "2026-11-05T10:00:00Z", window_end: "2026-11-06T10:00:00Z", duration_min: 60, scheduled_start: "2026-11-05T13:00:00Z" };
    expect(oldRule(k, "2026-11-06").shown).toBe(true); // ancienne règle : visible le 6, en haut de journée
    const p = placement(k, now);
    expect(occupies(p, ...day("2026-11-05"))).toBe(true);
    expect(occupies(p, ...day("2026-11-06"))).toBe(false);
  });

  it("plage qui se termine exactement à minuit : pas sur le lendemain", () => {
    const k = { ...qa, window_start: "2026-11-05T10:00:00Z", window_end: "2026-11-05T23:00:00Z" }; // minuit à Paris
    expect(occupies(placement(k, now), ...day("2026-11-06"))).toBe(false);
    expect(oldRule(k, "2026-11-06").shown).toBe(true); // ancienne règle (>=) : affichée à tort le 6
  });

  it("mission à cheval sur deux jours : présente les deux jours, découpée à minuit", () => {
    const k = { ...qa, window_start: "2026-11-05T18:00:00Z", window_end: "2026-11-06T08:00:00Z", scheduled_start: "2026-11-05T22:00:00Z", duration_min: 120 };
    const p = placement(k, now);
    if (p.kind === "unscheduled") throw new Error("attendu : planifiée");
    const d5 = day("2026-11-05");
    const d6 = day("2026-11-06");
    expect(occupies(p, ...d5) && occupies(p, ...d6)).toBe(true);
    expect(clip(p, ...d5)).toMatchObject({ fromPrevDay: false, toNextDay: true, end: d5[1] });
    expect(clip(p, ...d6)).toMatchObject({ fromPrevDay: true, toNextDay: false, start: d6[0] });
  });

  it("mission terminée : placée sur ses heures réelles (fin retenue prioritaire)", () => {
    const k = { ...qa, status: "done", started_at: "2026-11-06T08:00:00Z", completed_at: "2026-11-06T14:00:00Z", reported_end_at: "2026-11-06T09:30:00Z" };
    expect(placement(k, now)).toMatchObject({ kind: "actual", start: Date.parse("2026-11-06T08:00:00Z"), end: Date.parse("2026-11-06T09:30:00Z"), running: false, regularized: false });
  });

  it("fin régularisée par un responsable : jamais présentée comme une fin normale, preuves manquantes signalées", () => {
    const k = { ...qa, status: "done", started_at: "2026-11-06T08:00:00Z", completed_at: "2026-11-06T10:00:00Z", reported_end_at: "2026-11-06T10:00:00Z", regularized_at: "2026-11-06T14:00:00Z", regularized_missing: ["photos"] };
    expect(placement(k, now)).toMatchObject({ kind: "actual", regularized: true, missingProofs: true });
  });

  it("mission en cours oubliée : s'étend jusqu'à maintenant", () => {
    const k = { ...qa, status: "in_progress", started_at: "2026-11-06T08:00:00Z" };
    expect(placement(k, now)).toMatchObject({ kind: "actual", end: now, running: true });
  });

  it("changement de fuseau : la date dépend du fuseau du logement", () => {
    const k = { ...qa, scheduled_start: "2026-11-06T03:00:00Z", duration_min: 60 }; // 04:00 Paris, 22:00 la veille à New York
    const p = placement(k, now);
    expect(occupies(p, ...day("2026-11-06", PARIS))).toBe(true);
    expect(occupies(p, ...day("2026-11-05", "America/New_York"))).toBe(true);
    expect(occupies(p, ...day("2026-11-06", "America/New_York"))).toBe(false);
    expect(dayKey("2026-11-06T03:00:00Z", "America/New_York")).toBe("2026-11-05");
  });

  it("changement d'heure (25 octobre 2026, Paris) : journée de 25 h, bornes exactes", () => {
    const [s, e] = day("2026-10-25");
    expect((e - s) / 3_600_000).toBe(25);
  });
});
