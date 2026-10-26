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

/** Créneau occupé : [début planifié (ou début de fenêtre) ; + durée]. */
export function occupancy(task: Pick<Task, "scheduledStart" | "windowStart" | "durationMin">) {
  const start = new Date(task.scheduledStart ?? task.windowStart).getTime();
  return { start, end: start + task.durationMin * MINUTE };
}

/** Conflits d'une liste de tâches (toutes les tâches ouvertes de l'organisation). */
export function detectConflicts(tasks: Task[]): Conflict[] {
  const conflicts: Conflict[] = [];
  const active = tasks.filter((x) => x.status !== "cancelled" && x.status !== "validated");

  for (const task of active) {
    if (!task.assigneeId) continue;
    const { start, end } = occupancy(task);
    const ws = new Date(task.windowStart).getTime();
    const we = new Date(task.windowEnd).getTime();
    if (start < ws || end > we) conflicts.push({ taskId: task.id, kind: "outside_window" });
  }

  const byAgent = new Map<string, Task[]>();
  for (const task of active) {
    if (!task.assigneeId) continue;
    byAgent.set(task.assigneeId, [...(byAgent.get(task.assigneeId) ?? []), task]);
  }
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
 */
export function autoAssign(unassigned: Task[], agentIds: string[], existing: Task[]): AutoAssignment[] {
  const result: AutoAssignment[] = [];
  const busy = new Map<string, { start: number; end: number }[]>();
  for (const id of agentIds) busy.set(id, []);
  for (const task of existing) {
    if (!task.assigneeId || !busy.has(task.assigneeId)) continue;
    if (task.status === "cancelled" || task.status === "validated") continue;
    busy.get(task.assigneeId)!.push(occupancy(task));
  }

  const queue = [...unassigned].sort(
    (a, b) => new Date(a.windowEnd).getTime() - new Date(b.windowEnd).getTime(),
  );

  for (const task of queue) {
    const ws = new Date(task.windowStart).getTime();
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
