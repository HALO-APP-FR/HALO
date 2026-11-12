import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** « ≈ ≈ 100 m » (12/11) : le symbole vient de fmtDistance, jamais du libellé traduit. */
describe("libellé de distance avant l'ouverture", () => {
  for (const l of ["fr", "en", "es", "pt", "it", "de"]) {
    it(`${l} : aucun « ≈ » dans le libellé (déjà ajouté par fmtDistance)`, () => {
      const m = JSON.parse(readFileSync(`messages/${l}.json`, "utf8"));
      expect(m.guestSpace.around.distanceFromZone).not.toContain("≈");
      expect(m.guestSpace.around.distanceFromZone).toContain("{d}");
    });
  }
});
