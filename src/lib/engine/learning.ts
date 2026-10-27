/**
 * Apprentissage des durées et pointage — fonctions PURES.
 * Chaque ménage terminé (démarrer → terminer) alimente la durée prévue des suivants :
 * le planning se cale sur la réalité du terrain, logement par logement.
 */
import type { Property, Task } from "@/lib/domain/types";

const MINUTE = 60_000;
/** Nombre de ménages récents pris en compte. */
export const LEARN_WINDOW = 6;
/** En dessous, on garde la durée saisie par le manager. */
export const LEARN_MIN_SAMPLES = 3;

/** Durée réelle d'une mission pointée, en minutes (null si non pointée ou incohérente). */
export function actualMinutes(task: Pick<Task, "startedAt" | "completedAt">): number | null {
  if (!task.startedAt || !task.completedAt) return null;
  const min = (new Date(task.completedAt).getTime() - new Date(task.startedAt).getTime()) / MINUTE;
  // Pointage oublié (plus de 10 h) ou absurde : ignoré
  if (!Number.isFinite(min) || min < 5 || min > 600) return null;
  return Math.round(min);
}

const median = (values: number[]) => {
  const v = [...values].sort((a, b) => a - b);
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

export interface LearnedDuration {
  minutes: number;
  samples: number;
}

/**
 * Durée de ménage apprise pour un logement : médiane des derniers ménages pointés
 * (hors séjours avec animaux, qui ont leur propre supplément), arrondie à 5 min.
 */
export function learnedCleaningDuration(propertyId: string, tasks: Task[]): LearnedDuration | null {
  const samples = tasks
    .filter((x) => x.propertyId === propertyId && x.type === "turnover" && !x.pets && (x.status === "done" || x.status === "validated"))
    .map((x) => ({ at: x.completedAt ?? "", min: actualMinutes(x) }))
    .filter((x): x is { at: string; min: number } => x.min !== null)
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, LEARN_WINDOW)
    .map((x) => x.min);
  if (samples.length < LEARN_MIN_SAMPLES) return null;
  return { minutes: Math.max(15, Math.round(median(samples) / 5) * 5), samples: samples.length };
}

/** Logement tel que le moteur doit le voir : durée apprise si l'apprentissage est actif. */
export function withLearnedDuration(property: Property, tasks: Task[]): Property {
  if (property.learnDuration === false) return property;
  const learned = learnedCleaningDuration(property.id, tasks);
  return learned ? { ...property, cleaningDurationMin: learned.minutes } : property;
}

/** Minutes travaillées (missions pointées et terminées) par une personne entre deux instants. */
export function workedMinutes(tasks: Task[], memberId: string, from: Date, to: Date) {
  let total = 0;
  let count = 0;
  for (const x of tasks) {
    if (x.assigneeId !== memberId || !x.completedAt) continue;
    const end = new Date(x.completedAt).getTime();
    if (end < from.getTime() || end >= to.getTime()) continue;
    const min = actualMinutes(x);
    if (min === null) continue;
    total += min;
    count += 1;
  }
  return { minutes: total, count };
}

/** Écart moyen entre réel et prévu (en %, négatif = plus rapide que prévu). */
export function averageGap(tasks: Task[], memberId: string, from: Date, to: Date): number | null {
  const gaps: number[] = [];
  for (const x of tasks) {
    if (x.assigneeId !== memberId || !x.completedAt || !x.durationMin) continue;
    const end = new Date(x.completedAt).getTime();
    if (end < from.getTime() || end >= to.getTime()) continue;
    const min = actualMinutes(x);
    if (min !== null) gaps.push((min - x.durationMin) / x.durationMin);
  }
  return gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 100) : null;
}

/** « 2 h 05 », « 45 min ». */
export function formatDuration(minutes: number, locale: string) {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  const unit = (value: number, u: "hour" | "minute") =>
    new Intl.NumberFormat(locale, { style: "unit", unit: u, unitDisplay: "narrow" }).format(value);
  if (h === 0) return unit(m, "minute");
  if (m === 0) return unit(h, "hour");
  return `${unit(h, "hour")} ${String(m).padStart(2, "0")}`;
}
