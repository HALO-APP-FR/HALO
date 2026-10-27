import { describe, expect, it } from "vitest";
import {
  addDaysToKey,
  formatLocalTime,
  localMinutesOfDay,
  timeZoneOffsetMinutes,
  zonedTimeToUtc,
  isSameLocalDay,
  localDateKey,
  minutesBetween,
  turnoverPriority,
  formatLocalRange,
} from "@/lib/engine/time";

describe("localDateKey", () => {
  it("donne des jours différents à Paris et à Bali pour le même instant UTC", () => {
    const instant = new Date("2026-07-14T20:00:00Z"); // 22:00 à Paris, 04:00 le 15 à Bali
    expect(localDateKey(instant, "Europe/Paris")).toBe("2026-07-14");
    expect(localDateKey(instant, "Asia/Makassar")).toBe("2026-07-15");
  });
});

describe("isSameLocalDay", () => {
  it("rotation à J à Paris", () => {
    const out = new Date("2026-07-14T09:00:00Z"); // 11:00 Paris
    const inn = new Date("2026-07-14T14:00:00Z"); // 16:00 Paris
    expect(isSameLocalDay(out, inn, "Europe/Paris")).toBe(true);
  });

  it("le même couple d'instants n'est pas le même jour à Bali", () => {
    const out = new Date("2026-07-14T15:30:00Z"); // 23:30 le 14 à Bali
    const inn = new Date("2026-07-14T17:00:00Z"); // 01:00 le 15 à Bali
    expect(isSameLocalDay(out, inn, "Europe/Paris")).toBe(true);
    expect(isSameLocalDay(out, inn, "Asia/Makassar")).toBe(false);
  });

  it("reste juste lors du passage à l'heure d'hiver (25 octobre 2026)", () => {
    const out = new Date("2026-10-25T00:30:00Z"); // 02:30 CEST
    const inn = new Date("2026-10-25T22:30:00Z"); // 23:30 CET, toujours le 25
    expect(isSameLocalDay(out, inn, "Europe/Paris")).toBe(true);
  });
});

describe("formatLocalTime", () => {
  it("affiche l'heure du logement, pas celle du navigateur", () => {
    const instant = new Date("2026-07-14T13:00:00Z");
    expect(formatLocalTime(instant, "Europe/Lisbon", "fr")).toBe("14:00");
    expect(formatLocalTime(instant, "Europe/Paris", "fr")).toBe("15:00");
  });
});

describe("turnoverPriority", () => {
  const tz = "Europe/Paris";
  it("urgent quand la fenêtre est plus courte que le ménage", () => {
    expect(
      turnoverPriority({
        checkOutAt: new Date("2026-07-14T09:00:00Z"),
        nextCheckInAt: new Date("2026-07-14T10:00:00Z"),
        cleaningDurationMin: 120,
        timeZone: tz,
      }),
    ).toBe("urgent");
  });
  it("high pour une rotation à J", () => {
    expect(
      turnoverPriority({
        checkOutAt: new Date("2026-07-14T09:00:00Z"),
        nextCheckInAt: new Date("2026-07-14T14:00:00Z"),
        cleaningDurationMin: 120,
        timeZone: tz,
      }),
    ).toBe("high");
  });
  it("normal sans arrivée suivante", () => {
    expect(
      turnoverPriority({
        checkOutAt: new Date("2026-07-14T09:00:00Z"),
        nextCheckInAt: null,
        cleaningDurationMin: 120,
        timeZone: tz,
      }),
    ).toBe("normal");
  });
  it("minutesBetween", () => {
    expect(minutesBetween(new Date("2026-01-01T10:00:00Z"), new Date("2026-01-01T12:30:00Z"))).toBe(150);
  });
});

describe("zonedTimeToUtc", () => {
  it("Paris en été (UTC+2)", () => {
    expect(zonedTimeToUtc("2026-07-14", "11:00", "Europe/Paris").toISOString()).toBe("2026-07-14T09:00:00.000Z");
  });
  it("Paris en hiver (UTC+1)", () => {
    expect(zonedTimeToUtc("2026-12-01", "11:00", "Europe/Paris").toISOString()).toBe("2026-12-01T10:00:00.000Z");
  });
  it("Bali (UTC+8)", () => {
    expect(zonedTimeToUtc("2026-07-14", "16:00", "Asia/Makassar").toISOString()).toBe("2026-07-14T08:00:00.000Z");
  });
  it("New York le jour du passage à l'heure d'été", () => {
    expect(zonedTimeToUtc("2026-03-08", "16:00", "America/New_York").toISOString()).toBe("2026-03-08T20:00:00.000Z");
  });
  it("Paris le jour du passage à l'heure d'hiver, après le changement", () => {
    expect(zonedTimeToUtc("2026-10-25", "11:00", "Europe/Paris").toISOString()).toBe("2026-10-25T10:00:00.000Z");
  });
});

describe("helpers", () => {
  it("timeZoneOffsetMinutes", () => {
    expect(timeZoneOffsetMinutes(new Date("2026-07-14T12:00:00Z"), "Europe/Paris")).toBe(120);
    expect(timeZoneOffsetMinutes(new Date("2026-01-14T12:00:00Z"), "America/Los_Angeles")).toBe(-480);
  });
  it("localMinutesOfDay", () => {
    expect(localMinutesOfDay(new Date("2026-07-14T09:30:00Z"), "Europe/Paris")).toBe(11 * 60 + 30);
  });
  it("addDaysToKey traverse les fins de mois", () => {
    expect(addDaysToKey("2026-02-28", 1)).toBe("2026-03-01");
    expect(addDaysToKey("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("plage horaire d'une mission (heure locale du logement)", () => {
  it("même jour : pas de date de fin", () => {
    expect(formatLocalRange(new Date("2026-10-27T10:00:00Z"), new Date("2026-10-27T15:00:00Z"), "Europe/Paris", "fr")).toBe("11:00 → 16:00");
  });
  it("fenêtre qui traverse minuit : la date de fin est affichée", () => {
    expect(formatLocalRange(new Date("2026-10-27T10:00:00Z"), new Date("2026-10-28T15:00:00Z"), "Europe/Paris", "fr")).toBe("11:00 → mer. 28 16:00");
  });
  it("logement dans un autre fuseau : heures du logement, pas du navigateur", () => {
    expect(formatLocalRange(new Date("2026-10-27T11:00:00Z"), new Date("2026-10-27T15:00:00Z"), "Europe/Lisbon", "fr")).toBe("11:00 → 15:00");
    // 23:30 → 00:30 à Lisbonne : deux jours locaux différents
    expect(formatLocalRange(new Date("2026-10-27T23:30:00Z"), new Date("2026-10-28T00:30:00Z"), "Europe/Lisbon", "fr")).toBe("23:30 → mer. 28 0:30");
  });
  it("changement d'heure (passage à l'heure d'hiver le 25/10/2026)", () => {
    // 11:00 heure d'été (UTC+2) → lendemain 16:00 heure d'hiver (UTC+1)
    expect(formatLocalRange(new Date("2026-10-24T09:00:00Z"), new Date("2026-10-25T15:00:00Z"), "Europe/Paris", "fr")).toBe("11:00 → dim. 25 16:00");
    expect(formatLocalRange(new Date("2026-10-25T10:00:00Z"), new Date("2026-10-25T15:00:00Z"), "Europe/Paris", "fr")).toBe("11:00 → 16:00");
  });
});
