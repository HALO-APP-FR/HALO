/**
 * Génération des tâches à partir des réservations — docs/04-moteur-operations.md §2.
 * Fonction PURE : elle calcule les opérations à appliquer, sans rien modifier.
 * Idempotente : la relancer 100 fois sur le même état ne produit aucune opération.
 */
import type { Property, Reservation, Task, TaskPriority, TaskType } from "@/lib/domain/types";
import { LOCKED_STATUSES } from "@/lib/domain/types";
import { turnoverPriority } from "./time";

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/**
 * Règle du créneau de ménage (rotation) — docs/04 §2 :
 * - début : l'heure de départ du voyageur (ou son départ anticipé signalé) ;
 * - fin : l'arrivée suivante dans le logement, quel que soit le jour (même jour ou plusieurs jours après) ;
 * - sans arrivée suivante : départ + OPEN_WINDOW_DAYS jours (le ménage reste à faire, sans urgence) ;
 * - la DURÉE estimée (durée du logement, + temps animaux) est distincte de la FENÊTRE ;
 * - si la fenêtre est plus courte que la durée, si deux séjours se chevauchent, si le départ ou la durée
 *   est invalide : AUCUNE mission impossible n'est créée, un conflit est signalé au responsable.
 */
export const OPEN_WINDOW_DAYS = 3;
/** Temps de ménage ajouté quand des animaux ont séjourné (poils, odeurs). */
export const PET_EXTRA_MIN = 30;
const HORIZON_PAST_MS = DAY;
const HORIZON_FUTURE_MS = 90 * DAY;

export interface TaskDraft {
  propertyId: string;
  type: TaskType;
  reservationId: string;
  nextReservationId?: string;
  windowStart: string;
  windowEnd: string;
  priority: TaskPriority;
  durationMin: number;
  guestsCount?: number;
  babies?: number;
  pets?: number;
  vip?: boolean;
}

/** Conflit de planning signalé au responsable au lieu de créer une mission impossible. */
export interface ScheduleConflict {
  kind: "gap_too_short" | "stay_overlap" | "missing_checkout" | "invalid_duration";
  propertyId: string;
  reservationId: string;
  nextReservationId?: string;
  /** Minutes disponibles entre le départ et l'arrivée suivante (gap_too_short). */
  availableMin?: number;
  /** Minutes nécessaires (durée estimée du ménage). */
  neededMin?: number;
}

export interface TaskPatch {
  windowStart?: string;
  windowEnd?: string;
  priority?: TaskPriority;
  nextReservationId?: string;
  guestsCount?: number;
  babies?: number;
  pets?: number;
  vip?: boolean;
  durationMin?: number;
}

export type TaskNotice = { kind: "task_changed" | "task_cancelled"; taskId: string; assigneeId: string };

export interface TaskPlan {
  create: TaskDraft[];
  update: { id: string; patch: TaskPatch }[];
  cancel: string[];
  notify: TaskNotice[];
}

const iso = (ms: number) => new Date(ms).toISOString();
const t = (s: string) => new Date(s).getTime();

/** Calcule les tâches auto attendues pour un logement. */
export function expectedTasks(property: Property, reservations: Reservation[], now: Date): TaskDraft[] {
  return schedule(property, reservations, now).drafts;
}

/** Conflits de planning d'un logement (missions de ménage impossibles à créer). */
export function scheduleConflicts(property: Property, reservations: Reservation[], now: Date): ScheduleConflict[] {
  return schedule(property, reservations, now).conflicts;
}

function schedule(property: Property, reservations: Reservation[], now: Date): { drafts: TaskDraft[]; conflicts: ScheduleConflict[] } {
  const nowMs = now.getTime();
  const confirmed = reservations
    .filter((r) => r.propertyId === property.id && r.status === "confirmed")
    .sort((a, b) => t(a.checkInAt) - t(b.checkInAt));

  const drafts: TaskDraft[] = [];
  const conflicts: ScheduleConflict[] = [];
  confirmed.forEach((r, idx) => {
    // Départ anticipé signalé par le voyageur : la fenêtre de ménage s'ouvre plus tôt
    const plannedOut = t(r.checkOutAt);
    const outMs = r.departedAt ? Math.min(t(r.departedAt), plannedOut) : plannedOut;
    const inMs = t(r.checkInAt);
    if (!Number.isFinite(plannedOut) || !Number.isFinite(inMs)) {
      conflicts.push({ kind: "missing_checkout", propertyId: property.id, reservationId: r.id });
      return;
    }

    // Ménage de rotation : départ de R → arrivée suivante
    if (outMs >= nowMs - HORIZON_PAST_MS && outMs <= nowMs + HORIZON_FUTURE_MS) {
      // Séjour qui commence avant la fin de celui-ci : chevauchement, jamais un ménage « entre les deux »
      const overlapping = confirmed.slice(idx + 1).find((n) => t(n.checkInAt) < plannedOut);
      const next = confirmed.find((n) => n.id !== r.id && t(n.checkInAt) >= outMs);
      const windowEnd = next ? t(next.checkInAt) : outMs + OPEN_WINDOW_DAYS * DAY;
      const durationMin = property.cleaningDurationMin + (r.pets ? PET_EXTRA_MIN : 0);
      if (overlapping) {
        conflicts.push({ kind: "stay_overlap", propertyId: property.id, reservationId: r.id, nextReservationId: overlapping.id });
        return;
      }
      if (!Number.isFinite(property.cleaningDurationMin) || property.cleaningDurationMin < 5) {
        conflicts.push({ kind: "invalid_duration", propertyId: property.id, reservationId: r.id, nextReservationId: next?.id });
        return;
      }
      const availableMin = Math.floor((windowEnd - outMs) / MINUTE);
      if (availableMin < durationMin) {
        conflicts.push({ kind: "gap_too_short", propertyId: property.id, reservationId: r.id, nextReservationId: next?.id, availableMin: Math.max(0, availableMin), neededMin: durationMin });
        return;
      }
      drafts.push({
        propertyId: property.id,
        type: "turnover",
        reservationId: r.id,
        nextReservationId: next?.id,
        windowStart: iso(outMs),
        windowEnd: iso(windowEnd),
        priority: turnoverPriority({
          checkOutAt: new Date(outMs),
          nextCheckInAt: next ? new Date(t(next.checkInAt)) : null,
          cleaningDurationMin: property.cleaningDurationMin,
          timeZone: property.timezone,
        }),
        // Animaux chez le voyageur sortant = ménage plus long
        durationMin,
        // Préparation pour le voyageur entrant (linge, lit bébé…)
        guestsCount: next?.guestsCount,
        babies: next?.babies || undefined,
        pets: r.pets || undefined,
        vip: next?.vip || undefined,
      });
    }

    // Accueil des voyageurs
    if (property.checkInService && inMs >= nowMs - HORIZON_PAST_MS && inMs <= nowMs + HORIZON_FUTURE_MS) {
      drafts.push({
        propertyId: property.id,
        type: "check_in",
        reservationId: r.id,
        windowStart: iso(inMs - 30 * MINUTE),
        windowEnd: iso(inMs + 120 * MINUTE),
        priority: "normal",
        durationMin: 30,
        guestsCount: r.guestsCount,
        babies: r.babies || undefined,
        pets: r.pets || undefined,
        vip: r.vip || undefined,
      });
    }

    // Départ accompagné
    if (property.checkOutService && outMs >= nowMs - HORIZON_PAST_MS && outMs <= nowMs + HORIZON_FUTURE_MS) {
      drafts.push({
        propertyId: property.id,
        type: "check_out",
        reservationId: r.id,
        windowStart: iso(outMs - 15 * MINUTE),
        windowEnd: iso(outMs + 60 * MINUTE),
        priority: "normal",
        durationMin: 20,
        guestsCount: r.guestsCount,
        babies: r.babies || undefined,
        pets: r.pets || undefined,
        vip: r.vip || undefined,
      });
    }
  });
  return { drafts, conflicts };
}

/** Compare l'existant à l'attendu et renvoie les opérations à appliquer. */
export function planTasks(
  property: Property,
  reservations: Reservation[],
  existingTasks: Task[],
  now: Date,
): TaskPlan {
  const plan: TaskPlan = { create: [], update: [], cancel: [], notify: [] };
  const expected = expectedTasks(property, reservations, now);
  const key = (reservationId: string | undefined, type: TaskType) => `${reservationId}::${type}`;

  const autoTasks = existingTasks.filter(
    (x) => x.propertyId === property.id && x.isAutoGenerated && x.status !== "cancelled",
  );
  const byKey = new Map(autoTasks.map((x) => [key(x.reservationId, x.type), x]));
  // Mission reprise à la main (créneau corrigé, ménage créé manuellement) : la synchro ne la recrée pas en double
  const manual = existingTasks.filter((x) => x.propertyId === property.id && !x.isAutoGenerated && x.status !== "cancelled");
  const handledByHand = (d: TaskDraft) =>
    manual.some((x) => x.type === d.type && ((x.reservationId && x.reservationId === d.reservationId) || (d.type === "turnover" && d.nextReservationId && x.nextReservationId === d.nextReservationId)));
  const expectedKeys = new Set<string>();
  const reservationById = new Map(reservations.map((r) => [r.id, r]));

  for (const draft of expected) {
    const k = key(draft.reservationId, draft.type);
    expectedKeys.add(k);
    const current = byKey.get(k);
    if (!current) {
      if (!handledByHand(draft)) plan.create.push(draft);
      continue;
    }
    if (LOCKED_STATUSES.includes(current.status)) continue;

    const patch: TaskPatch = {};
    if (current.windowStart !== draft.windowStart) patch.windowStart = draft.windowStart;
    if (current.windowEnd !== draft.windowEnd) patch.windowEnd = draft.windowEnd;
    if (current.priority !== draft.priority) patch.priority = draft.priority;
    if (current.nextReservationId !== draft.nextReservationId) patch.nextReservationId = draft.nextReservationId;
    if (current.guestsCount !== draft.guestsCount) patch.guestsCount = draft.guestsCount;
    if (current.babies !== draft.babies) patch.babies = draft.babies;
    if (current.pets !== draft.pets) patch.pets = draft.pets;
    if (current.vip !== draft.vip) patch.vip = draft.vip;
    if (!current.durationLocked && current.durationMin !== draft.durationMin) patch.durationMin = draft.durationMin;
    if (Object.keys(patch).length > 0) {
      plan.update.push({ id: current.id, patch });
      const windowMoved = patch.windowStart !== undefined || patch.windowEnd !== undefined;
      if (windowMoved && current.assigneeId) {
        plan.notify.push({ kind: "task_changed", taskId: current.id, assigneeId: current.assigneeId });
      }
    }
  }

  // Tâches dont la réservation a disparu ou a été annulée
  for (const task of autoTasks) {
    if (expectedKeys.has(key(task.reservationId, task.type))) continue;
    if (LOCKED_STATUSES.includes(task.status)) continue;
    const reservation = task.reservationId ? reservationById.get(task.reservationId) : undefined;
    // Une tâche passée hors horizon dont la réservation existe toujours n'est pas annulée
    const gone = !reservation || reservation.status !== "confirmed";
    if (!gone) continue;
    plan.cancel.push(task.id);
    if (task.assigneeId) plan.notify.push({ kind: "task_cancelled", taskId: task.id, assigneeId: task.assigneeId });
  }

  return plan;
}
