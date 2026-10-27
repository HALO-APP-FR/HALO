/**
 * Détection de conflits de planning et répartition automatique — docs/04 §3.
 * Fonctions PURES.
 */
import type { Task } from "@/lib/domain/types";

const MINUTE = 60_000;

export type ConflictKind = "overlap" | "outside_window";

export interface Conflict {
  taskId: string;
  kind: ConflictKind;
  /** Pour un chevauchement : l'autre tâche concernée. */
  otherTaskId?: string;
}

/**
 * Créneau occupé : [début planifié ; + durée estimée] — jamais toute la fenêtre d'intervention.
 * Mission en cours : à partir de son démarrage réel.
 */
export function occupancy(task: Pick<Task, "scheduledStart" | "windowStart" | "durationMin"> & Partial<Pick<Task, "status" | "startedAt">>) {
  const from = task.status === "in_progress" && task.startedAt ? task.startedAt : task.scheduledStart ?? task.windowStart;
  const start = new Date(from).getTime();
  return { start, end: start + task.durationMin * MINUTE };
}

/** Missions qui occupent encore l'agenda d'un agent (terminées, validées et annulées exclues). */
const BLOCKING: Task["status"][] = ["assigned", "in_progress", "to_redo"];
const isBlocking = (task: Task) => Boolean(task.assigneeId) && BLOCKING.includes(task.status);

/** Conflits d'une liste de tâches (toutes les tâches ouvertes de l'organisation). */
export function detectConflicts(tasks: Task[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const active = tasks.filter(isBlocking);

  for (const task of active) {
    if (task.status === "in_progress") continue; // déjà démarrée : la fenêtre n'est plus une question de planning
    const { start, end } = occupancy(task);
    const ws = new Date(task.windowStart).getTime();
    const we = new Date(task.windowEnd).getTime();
    if (start < ws || end > we) conflicts.push({ taskId: task.id, kind: "outside_window" });
  }

  const byAgent = new Map<string, Task[]>();
  for (const task of active) byAgent.set(task.assigneeId!, [...(byAgent.get(task.assigneeId!) ?? []), task]);
  for (const list of byAgent.values()) {
    const sorted = [...list].sort((a, b) => occupancy(a).start - occupancy(b).start);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = occupancy(sorted[i]);
        const b = occupancy(sorted[j]);
        if (b.start >= a.end) break;
        conflicts.push({ taskId: sorted[i].id, kind: "overlap", otherTaskId: sorted[j].id });
        conflicts.push({ taskId: sorted[j].id, kind: "overlap", otherTaskId: sorted[i].id });
      }
    }
  }
  return conflicts;
}

/** Conflits qu'entraînerait l'affectation d'une tâche à un agent à une heure donnée. */
export function conflictsIfAssigned(task: Task, agentId: string, scheduledStart: string | undefined, allTasks: Task[]) {
  const candidate: Task = { ...task, assigneeId: agentId, scheduledStart, status: "assigned" };
  const others = allTasks.filter((x) => x.id !== task.id);
  return detectConflicts([...others, candidate]).filter((c) => c.taskId === task.id);
}

export interface AutoAssignment {
  taskId: string;
  agentId: string;
  scheduledStart: string;
}

/**
 * Répartition automatique (heuristique simple, docs/01-PROMPTS phase 6) :
 * tâches triées par fin de fenêtre (les plus pressées d'abord), chacune donnée à l'agent
 * qui peut la commencer le plus tôt dans sa fenêtre sans chevauchement, à charge égale
 * l'agent le moins chargé. Une tâche impossible à placer reste non assignée.
 * Les conflits sont calculés sur les créneaux (début + durée), jamais sur les fenêtres.
 * Limite : AUCUN temps de trajet entre logements n'est pris en compte.
 */
export function autoAssign(unassigned: Task[], agentIds: string[], existing: Task[], now?: Date): AutoAssignment[] {
  const result: AutoAssignment[] = [];
  const busy = new Map<string, { start: number; end: number }[]>();
  for (const id of agentIds) busy.set(id, []);
  for (const task of existing) {
    if (!task.assigneeId || !busy.has(task.assigneeId)) continue;
    if (isBlocking(task)) busy.get(task.assigneeId)!.push(occupancy(task));
    // Mission terminée : seules ses heures réellement pointées occupent l'agenda (jamais un créneau futur théorique)
    else if ((task.status === "done" || task.status === "validated") && task.startedAt && task.completedAt) {
      busy.get(task.assigneeId)!.push({ start: new Date(task.startedAt).getTime(), end: new Date(task.completedAt).getTime() });
    }
  }
  // Jamais de créneau proposé dans le passé (arrondi au quart d'heure suivant)
  const earliest = now ? Math.ceil(now.getTime() / (15 * MINUTE)) * 15 * MINUTE : -Infinity;

  const queue = [...unassigned].sort(
    (a, b) => new Date(a.windowEnd).getTime() - new Date(b.windowEnd).getTime(),
  );

  for (const task of queue) {
    const ws = Math.max(new Date(task.windowStart).getTime(), earliest);
    const we = new Date(task.windowEnd).getTime();
    const dur = task.durationMin * MINUTE;
    let best: { agentId: string; start: number; load: number } | null = null;

    for (const agentId of agentIds) {
      const slots = [...busy.get(agentId)!].sort((a, b) => a.start - b.start);
      // Premier créneau libre à partir du début de fenêtre
      let start = ws;
      for (const s of slots) {
        if (start + dur <= s.start) break;
        if (s.end > start) start = s.end;
      }
      if (start + dur > we) continue;
      const load = slots.reduce((sum, s) => sum + (s.end - s.start), 0);
      if (!best || start < best.start || (start === best.start && load < best.load)) {
        best = { agentId, start, load };
      }
    }

    if (best) {
      busy.get(best.agentId)!.push({ start: best.start, end: best.start + dur });
      result.push({ taskId: task.id, agentId: best.agentId, scheduledStart: new Date(best.start).toISOString() });
    }
  }
  return result;
}

/* ---------------- Faisabilité d'une mission dans sa fenêtre ---------------- */

/** Minutes de travail qui ne tiennent pas dans la fenêtre d'intervention complète (0 = tient). */
export function windowShortfallMin(task: Pick<Task, "windowStart" | "windowEnd" | "durationMin">) {
  const windowMin = (new Date(task.windowEnd).getTime() - new Date(task.windowStart).getTime()) / MINUTE;
  return Math.max(0, Math.round(task.durationMin - windowMin));
}

/**
 * Statuts d'une mission encore à faire et jamais démarrée.
 * Une mission en « Correction demandée » a déjà été faite une fois : elle est suivie
 * par le cycle de validation, pas signalée comme « non faite ».
 */
const NOT_STARTED: Task["status"][] = ["unassigned", "assigned"];

/** Mission non démarrée dont la fenêtre est terminée : en retard. */
export function isOverdue(task: Pick<Task, "status" | "windowEnd">, now: Date) {
  return NOT_STARTED.includes(task.status) && new Date(task.windowEnd).getTime() < now.getTime();
}

export type Infeasibility = "window_too_short" | "window_passed" | "too_late_today" | null;

/**
 * Pourquoi une mission ne peut pas (ou plus) être planifiée, dans l'état courant :
 * - window_too_short : la durée estimée dépasse la fenêtre entière ;
 * - window_passed : la fenêtre est terminée ;
 * - too_late_today : il ne reste plus assez de temps dans la fenêtre à partir de maintenant.
 */
export function infeasibility(task: Pick<Task, "status" | "windowStart" | "windowEnd" | "durationMin">, now: Date): Infeasibility {
  if (!NOT_STARTED.includes(task.status)) return null;
  if (windowShortfallMin(task) > 0) return "window_too_short";
  const end = new Date(task.windowEnd).getTime();
  if (end < now.getTime()) return "window_passed";
  const start = Math.max(new Date(task.windowStart).getTime(), now.getTime());
  if (start + task.durationMin * MINUTE > end) return "too_late_today";
  return null;
}
