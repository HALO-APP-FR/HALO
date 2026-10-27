/**
 * Lectures dérivées des données (fonctions pures, testables).
 */
import { FIELD_POSITIONS, type Member, type Property, type Reservation, type Task } from "@/lib/domain/types";
import { localDateKey } from "@/lib/engine/time";

export const byId = <T extends { id: string }>(list: T[]) => new Map(list.map((x) => [x.id, x]));

/** Instant de référence d'une tâche : son heure planifiée, sinon le début de sa fenêtre. */
export const taskAnchor = (task: Task) => task.scheduledStart ?? task.windowStart;

/** Jour local (fuseau du logement) d'une tâche. */
export function taskDayKey(task: Task, property: Property | undefined) {
  return localDateKey(new Date(taskAnchor(task)), property?.timezone ?? "UTC");
}

/** Tâches d'un jour donné (AAAA-MM-JJ, heure locale de chaque logement), hors annulées. */
export function tasksOfDay(tasks: Task[], properties: Property[], dayKey: string) {
  const props = byId(properties);
  return tasks
    .filter((x) => x.status !== "cancelled" && taskDayKey(x, props.get(x.propertyId)) === dayKey)
    .sort((a, b) => new Date(taskAnchor(a)).getTime() - new Date(taskAnchor(b)).getTime());
}

export function arrivalsOfDay(reservations: Reservation[], properties: Property[], dayKey: string) {
  const props = byId(properties);
  return reservations.filter((r) => {
    const p = props.get(r.propertyId);
    return r.status === "confirmed" && p && !p.archived && localDateKey(new Date(r.checkInAt), p.timezone) === dayKey;
  });
}

export function departuresOfDay(reservations: Reservation[], properties: Property[], dayKey: string) {
  const props = byId(properties);
  return reservations.filter((r) => {
    const p = props.get(r.propertyId);
    return r.status === "confirmed" && p && !p.archived && localDateKey(new Date(r.checkOutAt), p.timezone) === dayKey;
  });
}

/** Équipe terrain qui reçoit des missions logistiques (planning, répartition automatique). */
export const activeAgents = (members: Member[]) =>
  members.filter((m) => m.role === "agent" && m.active && FIELD_POSITIONS.includes(m.position ?? "housekeeper"));

/** Tout le personnel actif hors managers (y compris chauffeurs et chefs). */
export const activeStaff = (members: Member[]) => members.filter((m) => m.role === "agent" && m.active);

/** Prochaine réservation (en cours ou future) d'un logement. */
export function currentOrNextStay(reservations: Reservation[], propertyId: string, now: Date) {
  return reservations
    .filter((r) => r.propertyId === propertyId && r.status === "confirmed" && new Date(r.checkOutAt) > now)
    .sort((a, b) => new Date(a.checkInAt).getTime() - new Date(b.checkInAt).getTime())[0];
}

/** Responsable connecté (mode démo : le propriétaire de l'organisation). */
export const currentManager = (members: Member[]) => members.find((m) => m.role === "owner") ?? members.find((m) => m.role === "manager");
