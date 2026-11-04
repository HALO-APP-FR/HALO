import { describe, expect, it } from "vitest";
import { fromLocalInput, localInputIn, nextDay, zonedMidnight } from "@/lib/connected/format";

/** Brief du 4/11 (anomalie des dates) : une saisie locale reste la même journée, quel que soit le fuseau de l'appareil. */
describe("dates saisies : heure locale du logement, journées entières", () => {
  it("journée entière du 5 novembre à Paris : du 5 à 00:00 au 6 à 00:00 (heure de Paris)", () => {
    expect(zonedMidnight("2026-11-05", "Europe/Paris").toISOString()).toBe("2026-11-04T23:00:00.000Z");
    expect(zonedMidnight(nextDay("2026-11-05"), "Europe/Paris").toISOString()).toBe("2026-11-05T23:00:00.000Z");
  });
  it("fins de mois et d'année", () => {
    expect(nextDay("2026-11-30")).toBe("2026-12-01");
    expect(nextDay("2026-12-31")).toBe("2027-01-01");
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
  });
  it("changement d'heure : journée du 28 mars 2027 (23 h) et du 31 octobre 2027 (25 h) à Paris", () => {
    const a = zonedMidnight("2027-03-28", "Europe/Paris").getTime();
    const b = zonedMidnight("2027-03-29", "Europe/Paris").getTime();
    expect((b - a) / 3_600_000).toBe(23);
    const c = zonedMidnight("2027-10-31", "Europe/Paris").getTime();
    const d = zonedMidnight("2027-11-01", "Europe/Paris").getTime();
    expect((d - c) / 3_600_000).toBe(25);
  });
  it("champ date et heure : interprété dans le fuseau du logement, pas celui de l'appareil", () => {
    expect(fromLocalInput("2026-11-05T14:00", "Europe/Paris").toISOString()).toBe("2026-11-05T13:00:00.000Z");
    expect(fromLocalInput("2026-11-05T14:00", "America/New_York").toISOString()).toBe("2026-11-05T19:00:00.000Z");
    expect(localInputIn(new Date("2026-11-05T13:00:00Z"), "Europe/Paris")).toBe("2026-11-05T14:00");
    // Aller-retour stable, y compris le jour du changement d'heure
    for (const v of ["2027-03-28T01:30", "2027-03-28T04:00", "2027-10-31T01:30", "2027-10-31T04:00", "2026-12-31T23:30"]) {
      expect(localInputIn(fromLocalInput(v, "Europe/Paris"), "Europe/Paris")).toBe(v);
    }
  });
});
