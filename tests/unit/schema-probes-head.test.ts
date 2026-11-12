import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("server-only", () => ({}));

describe("sondes de migration", () => {
  it("n'utilisent jamais de requête HEAD (une table absente y répond sans erreur)", () => {
    expect(readFileSync("src/lib/connected/schema-probes.ts", "utf8")).not.toMatch(/head:\s*true/);
  });
});
