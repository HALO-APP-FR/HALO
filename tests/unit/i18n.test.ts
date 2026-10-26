import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : chaque texte utilisé dans le code existe dans les 6 langues,
 * et toutes les langues ont exactement les mêmes clés.
 */
const root = path.join(import.meta.dirname, "../..");
const LOCALES = ["fr", "en", "es", "pt", "it", "de"];

function flat(obj: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object") Object.assign(out, flat(v as Record<string, unknown>, `${prefix}${k}.`));
    else out[`${prefix}${k}`] = String(v);
  }
  return out;
}

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

const messages = Object.fromEntries(
  LOCALES.map((l) => [l, flat(JSON.parse(readFileSync(path.join(root, "messages", `${l}.json`), "utf8")))]),
);

describe("traductions", () => {
  it("toutes les langues ont les mêmes clés", () => {
    const ref = Object.keys(messages.fr).sort();
    for (const l of LOCALES) expect(Object.keys(messages[l]).sort(), l).toEqual(ref);
  });

  it("chaque clé utilisée dans le code existe", () => {
    const missing: string[] = [];
    for (const file of files(path.join(root, "src"))) {
      const src = readFileSync(file, "utf8");
      // Chaque appel t("…") dépend de la déclaration `const t = …` la plus proche au-dessus
      const decls = [
        ...src.matchAll(
          /const t = (?:await )?(?:useTranslations|getTranslations)\(\s*(?:"([\w.]+)"|\{[^}]*namespace:\s*"([\w.]+)"[^}]*\})?\s*\)/g,
        ),
      ].map((m) => ({ at: m.index ?? 0, ns: m[1] ?? m[2] ?? "" }));
      const nsAt = (pos: number) => [...decls].reverse().find((d) => d.at < pos)?.ns ?? "";
      for (const m of src.matchAll(/\bt\(\s*"([\w.]+)"/g)) {
        const ns = nsAt(m.index ?? 0);
        const key = ns ? `${ns}.${m[1]}` : m[1];
        if (!(key in messages.fr)) missing.push(`${path.relative(root, file)} → ${key}`);
      }
      for (const m of src.matchAll(/\bt\(`([\w.]+)\.\$\{/g)) {
        const ns = nsAt(m.index ?? 0);
        const prefix = ns ? `${ns}.${m[1]}.` : `${m[1]}.`;
        if (!Object.keys(messages.fr).some((k) => k.startsWith(prefix))) missing.push(`${path.relative(root, file)} → ${prefix}*`);
      }
    }
    expect(missing).toEqual([]);
  });
});
