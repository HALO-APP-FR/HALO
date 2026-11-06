import { zonedMidnight } from "./format";

/** Jour calendaire (AAAA-MM-JJ) d'un instant dans un fuseau donné. */
export function dayKey(d: Date | string | number, timeZone: string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));
}

/** Ajoute n jours calendaires à une clé AAAA-MM-JJ (sans dépendre du fuseau du serveur). */
export function addDays(key: string, n: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** Lundi de la semaine contenant la clé donnée. */
export function mondayOf(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  return addDays(key, -((dow + 6) % 7));
}

/** Bornes [début, fin) en instants réels pour n jours à partir d'une clé, dans le fuseau donné. */
export function dayRange(key: string, n: number, timeZone: string): { start: Date; end: Date; keys: string[] } {
  const keys = Array.from({ length: n }, (_, i) => addDays(key, i));
  return { start: zonedMidnight(key, timeZone), end: zonedMidnight(addDays(key, n), timeZone), keys };
}
