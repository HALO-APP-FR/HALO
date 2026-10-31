import { describe, expect, it } from "vitest";
import { analyzeRows, autoMap, detectDateOrder, isSensitiveHeader, normalizePhone, parseCsv, parseDateCell, TEMPLATES, toCsv, zonedIso } from "@/lib/engine/import";

const ctx = { properties: [{ id: "p-old", name: "Loft Bastille", external_ref: "LB", timezone: "Europe/Paris", check_in: "16:00:00", check_out: "11:00:00" }], stays: [], teamEmails: ["deja@exemple.fr"] };

describe("import de données", () => {
  it("lit un CSV « ; » avec guillemets, BOM et retours à la ligne", () => {
    const rows = parseCsv('﻿Nom;Consignes\r\n"Studio ""A""";"ligne 1\nligne 2"\r\n\r\nLoft;x\r\n');
    expect(rows).toEqual([["Nom", "Consignes"], ['Studio "A"', "ligne 1\nligne 2"], ["Loft", "x"]]);
    expect(parseCsv("a,b\n1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });
  it("propose les correspondances et écarte les colonnes sensibles", () => {
    expect(autoMap("stays", ["Listing", "Start date", "End date", "Guest name", "Confirmation code", "# of adults", "Code boîte à clés"])).toMatchObject({
      Listing: "property",
      "Start date": "check_in",
      "End date": "check_out",
      "Guest name": "guest_name",
      "Confirmation code": "external_ref",
      "# of adults": "adults",
      "Code boîte à clés": "",
    });
    expect(isSensitiveHeader("Code boîte à clés")).toBe(true);
    expect(isSensitiveHeader("Mot de passe Wi-Fi")).toBe(true);
    expect(isSensitiveHeader("N° passeport")).toBe(true);
    expect(isSensitiveHeader("Code postal")).toBe(false);
    expect(isSensitiveHeader("Confirmation code")).toBe(false);
  });
  it("reconnaît les dates françaises, ISO et Excel ; refuse une date impossible", () => {
    expect(parseDateCell("15/11/2026 16:30")).toEqual({ date: "2026-11-15", time: "16:30" });
    expect(parseDateCell("2026-11-15")).toEqual({ date: "2026-11-15" });
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell("46000")).toEqual({ date: "2025-12-09" });
    expect(detectDateOrder(["11/25/2026"])).toBe("mdy");
    expect(parseDateCell("11/25/2026", "mdy")).toEqual({ date: "2026-11-25" });
  });
  it("normalise les téléphones et convertit l'heure locale du logement", () => {
    expect(normalizePhone("06 12 34 56 78")).toBe("+33612345678");
    expect(normalizePhone("12")).toBeNull();
    expect(zonedIso("2026-07-01", "16:00", "Europe/Paris")).toBe("2026-07-01T14:00:00.000Z");
    expect(zonedIso("2026-12-01", "16:00", "Asia/Tokyo")).toBe("2026-12-01T07:00:00.000Z");
  });
  it("fichier imparfait : date invalide, logement inconnu, doublon — chaque problème signalé, rien d'écrit", () => {
    const headers = ["Logement", "Arrivée", "Départ", "Voyageur"];
    const rows = [
      { Logement: "Loft Bastille", Arrivée: "15/11/2026", Départ: "18/11/2026", Voyageur: "Alex" },
      { Logement: "Loft Bastille", Arrivée: "32/11/2026", Départ: "18/11/2026", Voyageur: "Bea" },
      { Logement: "Maison inconnue", Arrivée: "15/11/2026", Départ: "18/11/2026", Voyageur: "Chloé" },
      { Logement: "Loft Bastille", Arrivée: "15/11/2026", Départ: "18/11/2026", Voyageur: "Alex" },
    ];
    const out = analyzeRows("stays", headers, rows, autoMap("stays", headers), ctx);
    expect(out[0]).toMatchObject({ decision: "create", issues: [] });
    expect(out[0].data).toMatchObject({ property_id: "p-old", check_in_at: "2026-11-15T15:00:00.000Z", check_out_at: "2026-11-18T10:00:00.000Z" });
    expect(out[1]).toMatchObject({ decision: "reject", data: null });
    expect(out[1].issues).toContain("invalid_date:check_in");
    expect(out[2].issues).toContain("unknown_property");
    expect(out[3].issues).toContain("dup_in_file:1");
    expect(out[3].decision).toBe("ignore");
  });
  it("séjours rattachés aux logements du même fichier ; doublon existant proposé en association", () => {
    const props = analyzeRows("properties", ["Nom", "Ville", "Pays"], [{ Nom: "Studio Neuf", Ville: "Lyon", Pays: "France" }, { Nom: "loft bastille", Ville: "Paris", Pays: "" }], autoMap("properties", ["Nom", "Ville", "Pays"]), ctx);
    expect(props[0]).toMatchObject({ decision: "create", data: { country: "FR", timezone: "Europe/Paris" } });
    expect(props[1]).toMatchObject({ decision: "link", matchId: "p-old" });
    const fileProperties = props.map((p) => ({ row: p.row, name: p.label, timezone: "Europe/Paris", check_in: "16:00", check_out: "11:00", decision: p.decision, matchId: p.matchId }));
    const stays = analyzeRows("stays", ["Logement", "Arrivée", "Départ"], [{ Logement: "Studio Neuf", Arrivée: "2026-12-01", Départ: "2026-12-03" }], autoMap("stays", ["Logement", "Arrivée", "Départ"]), { ...ctx, fileProperties });
    expect(stays[0].data).toMatchObject({ property_row: 1, property_id: null });
  });
  it("équipe : contact, rôle, téléphone non reconnu signalé sans bloquer, doublon existant", () => {
    const h = ["Prénom", "Nom", "E-mail professionnel", "Téléphone professionnel", "Rôle"];
    const out = analyzeRows("team", h, [{ Prénom: "Lina", Nom: "Roy", "E-mail professionnel": "lina@exemple.fr", "Téléphone professionnel": "abc", Rôle: "Agent" }, { Prénom: "Max", Nom: "D", "E-mail professionnel": "deja@exemple.fr", "Téléphone professionnel": "", Rôle: "Responsable" }], autoMap("team", h), ctx);
    expect(out[0]).toMatchObject({ decision: "create", data: { role: "agent", phone: null } });
    expect(out[0].issues).toContain("invalid_phone");
    expect(out[1]).toMatchObject({ decision: "ignore" });
  });
  it("les modèles se relisent et se reconnaissent entièrement", () => {
    for (const kind of ["properties", "team", "stays"] as const) {
      const [headers] = parseCsv(toCsv(TEMPLATES[kind]));
      const mapping = autoMap(kind, headers);
      expect(Object.values(mapping).filter((v) => !v)).toEqual([]);
    }
  });
});
