import { describe, expect, it } from "vitest";
import { canOpenSpace, landingFor, spacesFor } from "@/lib/auth/spaces";

describe("espaces Manager / Agent", () => {
  it("un agent arrive directement dans l'espace Agent et ne peut pas ouvrir l'espace Manager", () => {
    const m = [{ role: "agent" as const, active: true }];
    expect(landingFor(m)).toEqual({ kind: "redirect", href: "/a/today" });
    expect(canOpenSpace(m, "manager")).toBe(false);
  });
  it("un manager arrive dans l'espace Manager", () => {
    expect(landingFor([{ role: "manager", active: true }])).toEqual({ kind: "redirect", href: "/today" });
  });
  it("deux rôles (gérant qui fait aussi le terrain, ou deux organisations) : choix", () => {
    expect(landingFor([{ role: "owner", active: true, hasFieldWork: true }])).toEqual({ kind: "choose", spaces: ["manager", "agent"] });
    expect(spacesFor([{ role: "manager", active: true }, { role: "agent", active: true }])).toEqual(["manager", "agent"]);
  });
  it("membre désactivé : aucun espace", () => {
    expect(landingFor([{ role: "manager", active: false }])).toEqual({ kind: "redirect", href: "/login" });
  });
});
