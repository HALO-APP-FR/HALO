import { describe, expect, it } from "vitest";
import { destinationQuery, directionsLink } from "@/lib/engine/directions";

const full = { name: "Canal", addressLine: "12 rue de l'Écluse", postalCode: "75010", city: "Paris" };

describe("itinéraires", () => {
  it("adresse complète, encodée correctement pour chaque service", () => {
    expect(directionsLink("google", full)).toBe("https://www.google.com/maps/dir/?api=1&destination=12%20rue%20de%20l'%C3%89cluse%2C%2075010%20Paris");
    expect(directionsLink("apple", full)).toBe("https://maps.apple.com/?daddr=12%20rue%20de%20l'%C3%89cluse%2C%2075010%20Paris");
    expect(directionsLink("waze", full)).toBe("https://waze.com/ul?q=12%20rue%20de%20l'%C3%89cluse%2C%2075010%20Paris&navigate=yes");
    expect(destinationQuery(full).precise).toBe(true);
  });
  it("coordonnées utilisées en priorité quand elles sont valides", () => {
    const d = { ...full, lat: 48.8721, lng: 2.3634 };
    expect(directionsLink("waze", d)).toBe("https://waze.com/ul?ll=48.872100%2C2.363400&navigate=yes");
    expect(directionsLink("google", d)).toContain("destination=48.872100%2C2.363400");
    expect(directionsLink("apple", d)).toBe("https://maps.apple.com/?daddr=48.872100%2C2.363400&q=Canal");
    // Coordonnées absurdes ou nulles : ignorées
    expect(directionsLink("waze", { ...full, lat: 0, lng: 0 })).toContain("?q=");
    expect(directionsLink("waze", { ...full, lat: 120, lng: 2 })).toContain("?q=");
  });
  it("adresse incomplète : repli sur nom + ville, signalé comme approximatif", () => {
    const q = destinationQuery({ name: "Studio & Co", city: "Lisboa" });
    expect(q).toEqual({ text: "Studio & Co, Lisboa", coords: undefined, precise: false });
    expect(directionsLink("google", { name: "Studio & Co", city: "Lisboa" })).toBe("https://www.google.com/maps/dir/?api=1&destination=Studio%20%26%20Co%2C%20Lisboa");
  });
});
