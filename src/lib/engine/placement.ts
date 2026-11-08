/**
 * Où une mission apparaît dans le temps — une seule règle pour le planning, l'accueil, la liste et la vue agent.
 *
 * Trois informations distinctes, jamais confondues :
 *  - la PLAGE autorisée (window_start → window_end) : quand l'intervention peut avoir lieu ;
 *  - la DURÉE estimée (duration_min) : le temps de travail prévu ;
 *  - le CRÉNEAU planifié (scheduled_start → + durée) : seulement s'il a été réellement fixé.
 * Une mission démarrée ou terminée se place sur ses heures réelles (démarrage → fin retenue / fin dans HALO).
 * Une mission sans créneau ni heure réelle est « à planifier » : elle n'occupe jamais une plage horaire.
 */
export type PlacementTask = {
  status: string;
  window_start: string;
  window_end: string;
  duration_min: number;
  scheduled_start: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  reported_end_at?: string | null;
  /** Fin régularisée par un responsable (migration 23) et preuves manquantes à ce moment */
  regularized_at?: string | null;
  regularized_missing?: string[] | null;
};

export type Placement =
  | { kind: "actual"; start: number; end: number; running: boolean; regularized: boolean; missingProofs: boolean }
  | { kind: "scheduled"; start: number; end: number }
  | { kind: "unscheduled"; windowStart: number; windowEnd: number };

export function placement(k: PlacementTask, now: number): Placement {
  const started = k.started_at ? Date.parse(k.started_at) : NaN;
  if (["in_progress", "done", "validated"].includes(k.status) && Number.isFinite(started)) {
    if (k.status === "in_progress") return { kind: "actual", start: started, end: Math.max(now, started + k.duration_min * 60_000), running: true, regularized: false, missingProofs: false };
    const endRaw = k.reported_end_at ?? k.completed_at;
    const end = endRaw ? Date.parse(endRaw) : started + k.duration_min * 60_000;
    // Fin régularisée : jamais présentée comme une fin déclarée par l'agent (« Réalisé »)
    return { kind: "actual", start: started, end: Math.max(end, started + 60_000), running: false, regularized: Boolean(k.regularized_at), missingProofs: (k.regularized_missing ?? []).length > 0 };
  }
  if (k.scheduled_start) {
    const s = Date.parse(k.scheduled_start);
    return { kind: "scheduled", start: s, end: s + k.duration_min * 60_000 };
  }
  return { kind: "unscheduled", windowStart: Date.parse(k.window_start), windowEnd: Date.parse(k.window_end) };
}

/** Intervalle [from, to) qui fait apparaître la mission un jour donné (bornes exclusives à minuit : pas de débordement sur le lendemain). */
export function occupies(p: Placement, dayStart: number, dayEnd: number): boolean {
  const [a, b] = p.kind === "unscheduled" ? [p.windowStart, p.windowEnd] : [p.start, p.end];
  return a < dayEnd && b > dayStart;
}

/** Portion visible dans la journée (pour une mission à cheval sur minuit) et indication des débordements. */
export function clip(p: Exclude<Placement, { kind: "unscheduled" }>, dayStart: number, dayEnd: number) {
  return { start: Math.max(p.start, dayStart), end: Math.min(p.end, dayEnd), fromPrevDay: p.start < dayStart, toNextDay: p.end > dayEnd };
}

/** Libellé horaire honnête, identique partout (planning, accueil, linge). */
export function whenLabel(p: Placement, tr: (key: string, values?: Record<string, string>) => string, at: (ms: number) => string, duration: string): string {
  if (p.kind === "unscheduled") return tr("when.window", { from: at(p.windowStart), to: at(p.windowEnd), duration });
  if (p.kind === "scheduled") return tr("when.scheduled", { from: at(p.start), to: at(p.end) });
  if (p.running) return tr("when.running", { from: at(p.start) });
  if (p.regularized) return tr(p.missingProofs ? "when.regularizedMissing" : "when.regularized", { from: at(p.start), to: at(p.end) });
  return tr("when.actual", { from: at(p.start), to: at(p.end) });
}
