/**
 * Placement d'une mission par glisser-déposer — fonction PURE.
 * Convertit une position (jour + minutes locales) en heure de début valide pour la fenêtre de la mission.
 */
import type { Task } from "@/lib/domain/types";
import { addDaysToKey, zonedTimeToUtc } from "./time";

const MINUTE = 60_000;
export const SNAP_MIN = 15;

export type DropResult =
  | { ok: true; start: string; adjusted: boolean }
  | { ok: false; reason: "outside_window" };

const hhmm = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/**
 * @param minutes minutes depuis minuit (heure locale du logement), arrondies au quart d'heure.
 * Si l'heure tombe hors fenêtre mais que le jour la recoupe, on recale au plus proche (adjusted).
 */
export function placeTask(
  task: Pick<Task, "windowStart" | "windowEnd" | "durationMin">,
  dayKey: string,
  minutes: number,
  timeZone: string,
): DropResult {
  const snapped = Math.max(0, Math.min(24 * 60 - SNAP_MIN, Math.round(minutes / SNAP_MIN) * SNAP_MIN));
  const wanted = zonedTimeToUtc(dayKey, hhmm(snapped), timeZone).getTime();
  const ws = new Date(task.windowStart).getTime();
  const we = new Date(task.windowEnd).getTime();
  const latest = Math.max(ws, we - task.durationMin * MINUTE);
  const dayStart = zonedTimeToUtc(dayKey, "00:00", timeZone).getTime();
  const dayEnd = zonedTimeToUtc(addDaysToKey(dayKey, 1), "00:00", timeZone).getTime();
  // Le jour visé ne recoupe pas la fenêtre : refus
  if (dayEnd <= ws || dayStart > latest) return { ok: false, reason: "outside_window" };
  const clamped = Math.min(Math.max(wanted, ws), latest);
  // Toujours sur un quart d'heure (si la fenêtre le permet)
  const rounded = Math.ceil(clamped / (SNAP_MIN * MINUTE)) * SNAP_MIN * MINUTE;
  const start = rounded <= latest ? rounded : clamped;
  return { ok: true, start: new Date(start).toISOString(), adjusted: start !== wanted };
}
