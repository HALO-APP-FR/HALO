/**
 * Cycle de fin de mission — règles pures, identiques à celles de la base
 * (supabase/migrations/20261028000001_lot1_cycle_mission.sql).
 *
 *   assigned (À faire) → in_progress (En cours) → done (Terminée, à valider) → validated (Validée)
 *   to_redo (Correction demandée) → in_progress → …
 *
 * En mode démo ces règles protègent l'interface ; en production, c'est la base qui les applique.
 */
import {
  CHECKLIST_TASK_TYPES,
  DEFAULT_VALIDATION_TYPES,
  type ChecklistItem,
  type Member,
  type Property,
  type Task,
  type TaskType,
} from "@/lib/domain/types";

export function checklistApplies(task: Pick<Task, "type">) {
  return CHECKLIST_TASK_TYPES.includes(task.type);
}

/** Points « photo exigée » sans photo dans le rapport de la mission. */
export function missingRequiredPhotos(task: Task, property: Property): ChecklistItem[] {
  if (!checklistApplies(task)) return [];
  return property.checklist.flatMap((r) => r.items).filter((i) => i.photoRequired && !(task.report?.photos[i.id]?.length));
}

export function needsValidation(type: TaskType, rules: TaskType[] | undefined) {
  return (rules ?? DEFAULT_VALIDATION_TYPES).includes(type);
}

export type StartCheck = { ok: true } | { ok: false; reason: "not_assignee" | "bad_status" };
export type SubmitCheck = { ok: true } | { ok: false; reason: "not_assignee" | "bad_status" | "missing_photos"; missing?: number };
export type ReviewCheck = { ok: true } | { ok: false; reason: "not_manager" | "bad_status" | "reason_required" | "missing_photos"; missing?: number };

/** Seul l'agent assigné démarre sa mission (à faire ou à corriger). */
export function canStart(task: Task, memberId: string | undefined): StartCheck {
  if (!memberId || task.assigneeId !== memberId) return { ok: false, reason: "not_assignee" };
  if (task.status !== "assigned" && task.status !== "to_redo") return { ok: false, reason: "bad_status" };
  return { ok: true };
}

/** Seul l'agent assigné soumet, une mission en cours, avec ses photos obligatoires. */
export function canSubmit(task: Task, property: Property, memberId: string | undefined): SubmitCheck {
  if (!memberId || task.assigneeId !== memberId) return { ok: false, reason: "not_assignee" };
  if (task.status !== "in_progress") return { ok: false, reason: "bad_status" };
  const missing = missingRequiredPhotos(task, property).length;
  if (missing > 0) return { ok: false, reason: "missing_photos", missing };
  return { ok: true };
}

const isManager = (m: Member | undefined) => !!m && m.active && (m.role === "owner" || m.role === "manager");

/** Validation : jamais silencieuse si une preuve exigée manque (il faut alors demander une correction). */
export function canValidate(task: Task, by: Member | undefined, property?: Property): ReviewCheck {
  if (!isManager(by)) return { ok: false, reason: "not_manager" };
  if (task.status !== "done") return { ok: false, reason: "bad_status" };
  const missing = property ? missingRequiredPhotos(task, property).length : 0;
  if (missing > 0) return { ok: false, reason: "missing_photos", missing };
  return { ok: true };
}

/** Points « photo exigée » avec leur pièce, pour dire précisément ce qui manque. */
export function requiredPhotoStatus(task: Task, property: Property) {
  if (!checklistApplies(task)) return [];
  return property.checklist.flatMap((room) =>
    room.items.filter((i) => i.photoRequired).map((item) => ({ room, item, photoIds: task.report?.photos[item.id] ?? [] })),
  );
}

export function canRequestCorrection(task: Task, by: Member | undefined, reason: string): ReviewCheck {
  if (!isManager(by)) return { ok: false, reason: "not_manager" };
  if (task.status !== "done" && task.status !== "validated") return { ok: false, reason: "bad_status" };
  if (!reason.trim()) return { ok: false, reason: "reason_required" };
  return { ok: true };
}
