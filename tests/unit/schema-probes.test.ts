import { readdirSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

describe("état du service : migrations vérifiées", () => {
  it("chaque migration du dépôt a une vérification (sauf celle reprise par une suivante)", async () => {
    const { SCHEMA_PROBES } = await import("@/lib/connected/schema-probes");
    const files = readdirSync("supabase/migrations").map((f) => f.split("_")[0]).filter((v) => v !== "20261031000001");
    expect(SCHEMA_PROBES.map((p) => p.version).sort()).toEqual(files.sort());
  });
});

describe("sondes : jamais « vérifié » sans preuve", () => {
  const client = (fn: (target: string) => { code?: string } | null) =>
    ({
      from: (t: string) => ({ select: (c: string) => ({ limit: () => Promise.resolve({ error: fn(`${t}.${c}`) }) }) }),
      rpc: (name: string) => Promise.resolve({ error: fn(`rpc.${name}`) }),
    }) as never;
  const id = <T,>(p: Promise<T>) => p;
  it("migration 26 absente : signalée manquante, les autres vérifiées", async () => {
    const { probeSchema } = await import("@/lib/connected/schema-probes");
    const res = await probeSchema(client((t) => (t.startsWith("linen_items") ? { code: "PGRST205" } : t.startsWith("rpc.") ? { code: "42501" } : null)), client((t) => (t.startsWith("rpc.") ? { code: "42501" } : null)), id);
    expect(res.filter((r) => r.state !== "ok").map((r) => `${r.version}:${r.state}`)).toEqual(["20261121000001:missing"]);
  });
  it("sans clé serveur ou réponse inattendue : « non vérifié »", async () => {
    const { probeSchema } = await import("@/lib/connected/schema-probes");
    const res = await probeSchema(null, client(() => ({ code: "XX000" })), id);
    expect(res.every((r) => r.state === "unverified")).toBe(true);
  });
});
