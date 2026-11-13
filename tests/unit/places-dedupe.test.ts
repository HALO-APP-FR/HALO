import { describe, expect, it } from "vitest";
import { dedupePlaces, normalizePlaceName } from "@/lib/engine/places";

const P = (id: string, name: string, lat: number | null, lng: number | null, extra: Record<string, unknown> = {}) => ({ id, source: "openstreetmap", name, lat, lng, address: null, ...extra });

describe("doublons de lieux (carte voyageur)", () => {
  it("normalise accents, ponctuation et casse", () => {
    expect(normalizePlaceName("Café de l'Église")).toBe(normalizePlaceName("CAFE DE L EGLISE"));
  });
  it("regroupe le même nom au même endroit (moins de 80 m) et garde la fiche la plus complète", () => {
    const r = dedupePlaces([P("a", "Boulangerie Martin", 48.86, 2.35), P("b", "Boulangerie  Martin", 48.8601, 2.3501, { phone: "01" })]);
    expect(r.places.map((p) => p.id)).toEqual(["b"]);
    expect(r.merged).toBe(1);
  });
  it("ne fusionne jamais deux noms différents, même voisins", () => {
    const r = dedupePlaces([P("a", "Carrefour City", 48.86, 2.35), P("b", "Carrefour Market", 48.86, 2.35)]);
    expect(r.places).toHaveLength(2);
  });
  it("garde deux enseignes identiques éloignées", () => {
    const r = dedupePlaces([P("a", "Monoprix", 48.86, 2.35), P("b", "Monoprix", 48.865, 2.35)]);
    expect(r.places).toHaveLength(2);
  });
  it("préfère la fiche de l'équipe, puis le favori du voyageur", () => {
    const team = { ...P("t", "Le Comptoir", 48.86, 2.35), source: "manager" };
    expect(dedupePlaces([P("o", "Le Comptoir", 48.86, 2.35), team]).places.map((p) => p.id)).toEqual(["t"]);
    expect(dedupePlaces([P("x", "Pharmacie", 48.86, 2.35), P("y", "Pharmacie", 48.86, 2.3502)], new Set(["y"])).places.map((p) => p.id)).toEqual(["y"]);
  });
  it("sans coordonnées : regroupe seulement à adresse identique", () => {
    expect(dedupePlaces([P("a", "Musée", null, null, { address: "1 rue A" }), P("b", "Musée", null, null, { address: "1 Rue A" })]).places).toHaveLength(1);
    expect(dedupePlaces([P("a", "Musée", null, null), P("b", "Musée", null, null)]).places).toHaveLength(2);
  });
});
