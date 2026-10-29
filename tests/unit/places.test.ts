import { describe, expect, it } from "vitest";
import { distanceM, geocodeQuery, overpassQuery, parseOverpass, SEARCH_RADIUS_M } from "@/lib/engine/places";
import { directionsLink } from "@/lib/engine/directions";

const HOME = { lat: 48.8606, lng: 2.3376 };
const el = (id: number, lat: number, lon: number, tags: Record<string, string>, type = "node") => ({ type, id, lat, lon, tags });

describe("lieux OpenStreetMap autour du logement", () => {
  it("requête : lieux nommés dans le rayon du logement, sans pays imposé", () => {
    const q = overpassQuery(HOME.lat, HOME.lng);
    expect(q).toContain(`around:${SEARCH_RADIUS_M},48.860600,2.337600`);
    expect(q).toContain('["name"]');
    expect(q).toContain("pharmacy");
  });

  it("catégories, adresse, horaires et distance repris tels quels ; rien d'inventé", () => {
    const { places, dataDate } = parseOverpass(
      {
        osm3s: { timestamp_osm_base: "2026-10-29T20:00:00Z" },
        elements: [
          el(1, 48.861, 2.338, { amenity: "cafe", name: "Café Été", "addr:housenumber": "3", "addr:street": "Rue de l'Écluse", "addr:postcode": "75001", "addr:city": "Paris", opening_hours: "Mo-Su 08:00-20:00" }),
          el(2, 48.8607, 2.3377, { amenity: "pharmacy", name: "Pharmacie" }),
          { type: "way", id: 3, center: { lat: 48.862, lon: 2.336 }, tags: { leisure: "park", name: "Jardin" } },
          el(4, 48.861, 2.338, { amenity: "bench" }), // sans nom ni catégorie : ignoré
          el(5, 48.95, 2.3376, { amenity: "restaurant", name: "Trop loin" }), // hors rayon : jamais affiché
          el(1, 48.861, 2.338, { amenity: "cafe", name: "Café Été" }), // doublon
        ],
      },
      HOME.lat,
      HOME.lng,
    );
    expect(dataDate).toBe("2026-10-29T20:00:00.000Z");
    expect(places.map((p) => [p.name, p.category])).toEqual([["Café Été", "food"], ["Jardin", "activities"], ["Pharmacie", "services"]]);
    const cafe = places[0];
    expect(cafe.address).toBe("3 Rue de l'Écluse, 75001 Paris");
    expect(cafe.openingHours).toBe("Mo-Su 08:00-20:00");
    expect(places.find((p) => p.name === "Pharmacie")!.openingHours).toBeNull();
    expect(places.every((p) => p.distanceM <= SEARCH_RADIUS_M)).toBe(true);
  });

  it("distance (haversine) cohérente", () => {
    expect(distanceM(48.8606, 2.3376, 48.8606, 2.3376)).toBe(0);
    expect(Math.abs(distanceM(48.8566, 2.3522, 45.764, 4.8357) - 392_000)).toBeLessThan(3_000); // Paris → Lyon
  });

  it("adresse à géocoder : celle du logement, sans pays codé en dur", () => {
    expect(geocodeQuery({ addressLine: "Calle Mayor 1", postalCode: "28013", city: "Madrid" })).toBe("Calle Mayor 1, 28013 Madrid");
    expect(geocodeQuery({ city: "São Paulo" })).toBe("São Paulo");
  });
});

describe("itinéraires vers le logement (international, accents)", () => {
  const dest = { name: "Appartement", addressLine: "12 Rue de l'Église", postalCode: "06400", city: "Cannes", countryCode: "FR" };
  it("adresse encodée correctement pour les trois applications", () => {
    for (const app of ["apple", "google", "waze"] as const) {
      const url = directionsLink(app, dest);
      expect(decodeURIComponent(url)).toContain("12 Rue de l'Église, 06400 Cannes");
      expect(url).not.toContain(" ");
    }
  });
  it("coordonnées utilisées quand elles existent", () => {
    expect(directionsLink("waze", { ...dest, lat: 43.5528, lng: 7.0174 })).toBe("https://waze.com/ul?ll=43.552800%2C7.017400&navigate=yes");
    expect(directionsLink("google", { name: "Riad", city: "Marrakech", addressLine: "Derb Sidi Ahmed", lat: 31.6295, lng: -7.9811 })).toContain("31.629500%2C-7.981100");
  });
});
