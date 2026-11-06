import { dayKey, dayRange } from "./days";

/** Valeurs des filtres de la liste des missions (partagées serveur / navigateur). */
export const PERIODS = ["today", "week", "upcoming", "past"] as const;
export const STATUS_FILTERS = ["todo", "unassigned", "assigned", "in_progress", "done", "to_redo", "validated", "all"] as const;
export const TYPES = ["turnover", "check_in", "check_out", "linen_delivery", "linen_pickup", "inspection", "maintenance", "other"] as const;
/** Groupes de types (un filtre = plusieurs types) : « linen » = livraisons + collectes de linge. */
export const TYPE_GROUPS = { linen: ["linen_delivery", "linen_pickup"] } as const;
export const TYPE_FILTERS = [...TYPES, ...Object.keys(TYPE_GROUPS)] as readonly string[];

/** Types réels couverts par un filtre de type (vide = tous). */
export function typesOf(filter: string): string[] {
  if (!filter) return [];
  if (filter in TYPE_GROUPS) return [...TYPE_GROUPS[filter as keyof typeof TYPE_GROUPS]];
  return (TYPES as readonly string[]).includes(filter) ? [filter] : [];
}

/** Statuts couverts par un filtre de statut (null = tous sauf annulées). */
export function statusesOf(filter: string): string[] | null {
  if (filter === "todo") return ["unassigned", "assigned", "in_progress", "to_redo", "done"];
  if (filter === "all") return null;
  return [filter];
}

/**
 * Bornes d'une période, dans le fuseau de l'organisation (jamais celui du serveur).
 * Une mission appartient à la période si sa plage la recoupe : window_start < to ET window_end > from (bornes strictes :
 * une plage qui se termine à minuit n'appartient pas au lendemain). Même règle pour les compteurs et la liste ouverte.
 */
export function periodBounds(period: string, now: Date, timeZone: string): { from?: Date; to?: Date; endedBefore?: Date } {
  const today = dayKey(now, timeZone);
  if (period === "today") {
    const r = dayRange(today, 1, timeZone);
    return { from: r.start, to: r.end };
  }
  if (period === "week") {
    const r = dayRange(today, 7, timeZone);
    return { from: r.start, to: r.end };
  }
  if (period === "past") return { endedBefore: now };
  return { from: new Date(now.getTime() - 86_400_000) };
}
