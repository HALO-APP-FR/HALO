import { describe, expect, it } from "vitest";
import { zoneCenter } from "@/lib/engine/zone";
import { distanceM } from "@/lib/engine/places";

describe("zone approximative du logement", () => {
  it("même centre qu'en base (public.zone_center)", () => {
    const c = zoneCenter(48.8612, 2.3512);
    expect(c.lat.toFixed(9)).toBe("48.862500000");
    expect(c.lng.toFixed(9)).toBe("2.359894790");
  });
  it("deux points de la même maille donnent exactement le même centre", () => {
    expect(zoneCenter(48.8601, 2.3501)).toEqual(zoneCenter(48.8649, 2.3549));
  });
  it("le centre reste à moins de 1,3 km du logement (zone ≈ quartier)", () => {
    for (const [lat, lng] of [[48.8601, 2.3501], [43.6045, 1.444], [45.9, 6.1], [-33.86, 151.2], [64.14, -21.94]]) {
      const c = zoneCenter(lat, lng);
      expect(distanceM(lat, lng, c.lat, c.lng)).toBeLessThan(1300);
    }
  });
});
