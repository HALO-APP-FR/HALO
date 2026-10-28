/**
 * Poste de pilotage des arrivées.
 *
 * Pour chaque séjour qui arrive, HALO rassemble ce qui menace la préparation du logement
 * (ménage, preuves, incidents, linge, prestations), avec pour chaque point :
 * la cause, l'objet concerné, le responsable et l'action qui le résout.
 *
 * État global d'une arrivée (le plus grave l'emporte, une arrivée n'est comptée qu'une fois) :
 *   - blocked    : ne sera pas prête sans une décision ou une action d'un responsable ;
 *   - watch      : en bonne voie, mais un point demande un œil (validation, correction en cours…) ;
 *   - preparing  : ménage planifié et faisable, ou en cours ;
 *   - ready      : ménage validé, aucun incident urgent ouvert.
 */
import type { Alert, Reservation, ServiceRequest, Task } from "@/lib/domain/types";
import { infeasibility, type Infeasibility } from "./conflicts";

export type ArrivalState = "blocked" | "watch" | "preparing" | "ready";
const RANK: Record<ArrivalState, number> = { ready: 0, preparing: 1, watch: 2, blocked: 3 };

export type BlockerKind =
  | "no_cleaning"
  | "cleaning_unassigned"
  | "cleaning_infeasible"
  | "cleaning_late_start"
  | "awaiting_validation"
  | "correction"
  | "urgent_incident"
  | "open_incident"
  | "linen_shortage"
  | "service_pending"
  | "guest_arrived_not_ready";

export type Responsible = { kind: "member"; id: string } | { kind: "manager" } | { kind: "nobody" };
export type ArrivalAction =
  | { kind: "assign"; taskId: string }
  | { kind: "review"; taskId: string }
  | { kind: "open_task"; taskId: string }
  | { kind: "create_cleaning" }
  | { kind: "open_incident"; alertId: string }
  | { kind: "open_service"; serviceId: string }
  | { kind: "open_linen" };

export interface Blocker {
  kind: BlockerKind;
  severity: Exclude<ArrivalState, "ready" | "preparing">;
  responsible: Responsible;
  action: ArrivalAction;
  /** Détail de la cause (ex. type d'irréalisabilité). */
  detail?: Infeasibility | string;
}

export interface ArrivalRow {
  stay: Reservation;
  state: ArrivalState;
  /** Minutes avant l'arrivée prévue (négatif : heure d'arrivée dépassée). */
  minutesLeft: number;
  cleaning?: Task;
  blockers: Blocker[];
}

export interface ArrivalInput {
  stays: Reservation[];
  tasks: Task[];
  alerts: Alert[];
  services: ServiceRequest[];
  /** Jours (clé AAAA-MM-JJ, fuseau du logement) où une rupture de linge est prévue. */
  linenShortageDays?: Set<string>;
  /** Clé de jour du ménage dans le fuseau du logement. */
  dayKeyOf?: (task: Task) => string;
  now: Date;
}

export function arrivalControl(input: ArrivalInput): ArrivalRow[] {
  const { now } = input;
  return input.stays
    .filter((s) => s.status === "confirmed")
    .map((stay) => {
      const blockers: Blocker[] = [];
      const cleaning = input.tasks.find((x) => x.type === "turnover" && x.nextReservationId === stay.id && x.status !== "cancelled");
      const minutesLeft = Math.round((new Date(stay.checkInAt).getTime() - now.getTime()) / 60_000);
      let base: ArrivalState = "preparing";

      if (!cleaning) {
        blockers.push({ kind: "no_cleaning", severity: "blocked", responsible: { kind: "manager" }, action: { kind: "create_cleaning" } });
      } else {
        const who: Responsible = cleaning.assigneeId ? { kind: "member", id: cleaning.assigneeId } : { kind: "nobody" };
        const issue = infeasibility(cleaning, now);
        switch (cleaning.status) {
          case "validated":
            base = "ready";
            break;
          case "done":
            blockers.push({ kind: "awaiting_validation", severity: "watch", responsible: { kind: "manager" }, action: { kind: "review", taskId: cleaning.id } });
            break;
          case "to_redo":
            blockers.push({ kind: "correction", severity: "watch", responsible: who, action: { kind: "open_task", taskId: cleaning.id } });
            break;
          case "in_progress":
            break;
          case "unassigned":
            blockers.push({ kind: "cleaning_unassigned", severity: "blocked", responsible: { kind: "manager" }, action: { kind: "assign", taskId: cleaning.id } });
            if (issue) blockers.push({ kind: "cleaning_infeasible", severity: "blocked", responsible: { kind: "manager" }, action: { kind: "open_task", taskId: cleaning.id }, detail: issue });
            break;
          default:
            if (issue) {
              blockers.push({ kind: "cleaning_infeasible", severity: "blocked", responsible: { kind: "manager" }, action: { kind: "open_task", taskId: cleaning.id }, detail: issue });
            } else if (cleaning.scheduledStart && new Date(cleaning.scheduledStart).getTime() + 15 * 60_000 < now.getTime()) {
              // Créneau commencé depuis plus de 15 min sans démarrage : encore faisable, à surveiller
              blockers.push({ kind: "cleaning_late_start", severity: "watch", responsible: who, action: { kind: "open_task", taskId: cleaning.id } });
            }
        }
        if (cleaning.status !== "validated" && input.dayKeyOf && input.linenShortageDays?.has(input.dayKeyOf(cleaning))) {
          blockers.push({ kind: "linen_shortage", severity: "watch", responsible: { kind: "manager" }, action: { kind: "open_linen" } });
        }
      }

      for (const a of input.alerts) {
        if (a.propertyId !== stay.propertyId || a.status === "resolved") continue;
        // Responsable d'un incident : la personne qui l'a pris en charge (démo : nom) ou personne
        const responsible: Responsible = a.takenBy ? { kind: "manager" } : { kind: "nobody" };
        if (a.urgent) blockers.push({ kind: "urgent_incident", severity: "blocked", responsible, action: { kind: "open_incident", alertId: a.id } });
        else blockers.push({ kind: "open_incident", severity: "watch", responsible, action: { kind: "open_incident", alertId: a.id } });
      }
      for (const s of input.services) {
        if (s.reservationId === stay.id && (s.status === "requested" || s.status === "info_requested")) {
          blockers.push({ kind: "service_pending", severity: "watch", responsible: { kind: "manager" }, action: { kind: "open_service", serviceId: s.id } });
        }
      }

      // Voyageur arrivé (heure d'arrivée dépassée) dans un logement qui n'est pas prêt
      const notReadyYet = base !== "ready" || blockers.some((b) => b.kind === "urgent_incident");
      if (minutesLeft < 0 && notReadyYet && cleaning) {
        blockers.unshift({ kind: "guest_arrived_not_ready", severity: "blocked", responsible: { kind: "manager" }, action: { kind: "open_task", taskId: cleaning.id } });
      }

      const worst = blockers.reduce<ArrivalState>((acc, b) => (RANK[b.severity] > RANK[acc] ? b.severity : acc), base);
      // Prêt seulement si aucun point ouvert : un incident non urgent fait passer « à surveiller »
      const state: ArrivalState = base === "ready" && blockers.length === 0 ? "ready" : worst === "ready" ? "watch" : worst;
      blockers.sort((x, y) => RANK[y.severity] - RANK[x.severity]);
      return { stay, state, minutesLeft, cleaning, blockers };
    })
    .sort((a, b) => RANK[b.state] - RANK[a.state] || a.minutesLeft - b.minutesLeft);
}

/** Compteurs sans double compte : une arrivée = un état. */
export function arrivalCounts(rows: ArrivalRow[]) {
  const c = { blocked: 0, watch: 0, preparing: 0, ready: 0 };
  for (const r of rows) c[r.state] += 1;
  return c;
}
