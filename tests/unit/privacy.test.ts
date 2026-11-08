import { describe, expect, it } from "vitest";
import { beforeAccess, revealsHome, streetOf } from "@/lib/engine/privacy";

describe("protection de l'adresse avant l'ouverture", () => {
  it("repère les textes qui situent le logement (même liste qu'en base)", () => {
    for (const s of ["Boulangerie en bas de l'immeuble", "Juste à côté du logement", "à 50 m", "5 min à pied", "Downstairs bakery", "Au 3e étage", "Notre voisin fait du pain"]) expect(revealsHome(s), s).toBe(true);
    for (const s of ["Pain au levain", "Ouvert le dimanche", "Menu à 25 €", "Musée gratuit le 1er dimanche", null]) expect(revealsHome(s), String(s)).toBe(false);
  });

  it("rue du logement sans numéro", () => {
    expect(streetOf("8 bis rue des Tests, 75011 Paris")).toBe("rue des tests");
    expect(streetOf(null)).toBeNull();
  });

  it("choix de l'équipe et garde-fous automatiques", () => {
    const home = { lat: 48.8601, lng: 2.3501, address: "8 bis rue des Tests, 75011 Paris" };
    expect(beforeAccess({ guest_visibility: "access", lat: 48.8682, lng: 2.3501, address: "3 avenue publique" }, home)).toBe("access");
    expect(beforeAccess({ guest_visibility: "booking", lat: 48.8682, lng: 2.3501, address: "3 avenue publique" }, home)).toBe("booking");
    expect(beforeAccess({ guest_visibility: "booking", lat: 48.861, lng: 2.3501, address: "1 place publique" }, home)).toBe("near");
    expect(beforeAccess({ guest_visibility: "booking", lat: 48.8655, lng: 2.3501, address: "40 rue des Tests, Paris" }, home)).toBe("same_street");
  });
});
