import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("cn", () => {
  it("garde la taille typographique quand on ajoute une couleur", () => {
    expect(cn("text-display", "text-danger")).toBe("text-display text-danger");
    expect(cn("text-micro", "text-danger")).toBe("text-micro text-danger");
  });
  it("remplace bien deux couleurs en conflit", () => {
    expect(cn("text-muted", "text-danger")).toBe("text-danger");
  });
});
