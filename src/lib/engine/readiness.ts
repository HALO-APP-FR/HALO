/**
 * « Le logement est-il réellement prêt pour le prochain voyageur ? »
 *
 * Réponse calculée à partir du même dossier opérationnel que le reste de HALO :
 * ménage lié au séjour entrant, son statut et ses preuves, incidents ouverts du logement.
 * « Prêt » n'est jamais affiché sur la base d'une supposition : il faut un ménage validé
 * (ou validé automatiquement selon la règle de l'organisation) et aucun incident urgent ouvert.
 */
import type { Alert, Reservation, Task } from "@/lib/domain/types";
import { infeasibility } from "./conflicts";

export type Readiness =
  | "ready" // ménage validé, rien de bloquant
  | "awaiting_validation" // ménage terminé, en attente du responsable
  | "in_progress" // ménage en cours
  | "correction" // correction demandée
  | "scheduled" // ménage assigné, faisable
  | "unassigned" // ménage sans agent
  | "at_risk" // ménage irréalisable ou en retard
  | "no_cleaning"; // aucun ménage relié à ce séjour

export const READINESS_TONE: Record<Readiness, "success" | "warning" | "danger" | "accent" | "neutral"> = {
  ready: "success",
  awaiting_validation: "warning",
  in_progress: "accent",
  correction: "danger",
  scheduled: "neutral",
  unassigned: "danger",
  at_risk: "danger",
  no_cleaning: "warning",
};

export interface ReadinessResult {
  level: Readiness;
  /** Ménage concerné (pour ouvrir la mission). */
  taskId?: string;
  /** Incident urgent ouvert sur le logement : empêche « prêt ». */
  urgentIncident: boolean;
}

export function readinessFor(stay: Reservation, tasks: Task[], alerts: Alert[], now: Date): ReadinessResult {
  const cleaning = tasks.find((x) => x.type === "turnover" && x.nextReservationId === stay.id && x.status !== "cancelled");
  const urgentIncident = alerts.some((a) => a.propertyId === stay.propertyId && a.urgent && a.status !== "resolved");
  if (!cleaning) return { level: "no_cleaning", urgentIncident };
  const base = { taskId: cleaning.id, urgentIncident };
  switch (cleaning.status) {
    case "validated":
      return { ...base, level: urgentIncident ? "at_risk" : "ready" };
    case "done":
      return { ...base, level: "awaiting_validation" };
    case "in_progress":
      return { ...base, level: "in_progress" };
    case "to_redo":
      return { ...base, level: "correction" };
    default:
      if (infeasibility(cleaning, now)) return { ...base, level: "at_risk" };
      return { ...base, level: cleaning.status === "unassigned" ? "unassigned" : "scheduled" };
  }
}

/**
 * Arrivées qui demandent une action d'un responsable maintenant.
 * Un ménage simplement planifié ou en cours suit son cours : il n'est pas signalé.
 */
const ACTION_LEVELS: Readiness[] = ["at_risk", "unassigned", "correction", "no_cleaning", "awaiting_validation"];
export const needsAttention = (r: ReadinessResult) => ACTION_LEVELS.includes(r.level) || r.urgentIncident;
