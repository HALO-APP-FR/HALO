/**
 * Disponibilités de l'équipe — fonctions PURES, miroir des règles de la base
 * (public.free_minutes_of / check_assignee_available, migration 9).
 *
 * Règles :
 * - seules les absences ACCEPTÉES bloquent (en attente : signalées, refusées / annulées : ignorées) ;
 * - une fermeture d'équipe concerne tout le monde, ou seulement un poste si elle en précise un ;
 * - une mission reste attribuable si elle tient dans le plus long temps libre de sa fenêtre
 *   (une absence partielle ne bloque que ce qu'elle recouvre réellement) ;
 * - rien n'est jamais réaffecté automatiquement : les conflits sont listés pour le responsable.
 */
const MINUTE = 60_000;

export type AbsenceStatus = "pending" | "accepted" | "refused" | "cancelled";
export interface Absence {
  id: string;
  scope: "member" | "team";
  memberId: string | null;
  teamPosition: string | null;
  kind: "leave" | "unavailable" | "closure";
  startsAt: string;
  endsAt: string;
  status: AbsenceStatus;
}
export interface Member {
  id: string;
  position: string | null;
}
export interface PlannedTask {
  id: string;
  assigneeId: string | null;
  status: string;
  windowStart: string;
  windowEnd: string;
  durationMin: number;
}

const ms = (s: string) => new Date(s).getTime();
const concerns = (a: Absence, m: Member) =>
  a.scope === "member" ? a.memberId === m.id : a.teamPosition == null || a.teamPosition === m.position;

/** Plus long temps libre (minutes) de la personne dans la fenêtre, hors absences du statut voulu. */
export function freeMinutes(member: Member, windowStart: string, windowEnd: string, absences: Absence[], statuses: AbsenceStatus[] = ["accepted"]): number {
  const ws = ms(windowStart);
  const we = ms(windowEnd);
  const blocks = absences
    .filter((a) => statuses.includes(a.status) && concerns(a, member) && ms(a.startsAt) < we && ms(a.endsAt) > ws)
    .map((a) => [Math.max(ms(a.startsAt), ws), Math.min(ms(a.endsAt), we)] as const)
    .sort((x, y) => x[0] - y[0]);
  let cur = ws;
  let best = 0;
  for (const [s, e] of blocks) {
    if (s > cur) best = Math.max(best, s - cur);
    cur = Math.max(cur, e);
  }
  if (we > cur) best = Math.max(best, we - cur);
  return Math.floor(best / MINUTE);
}

/** La personne peut-elle recevoir cette mission (même règle que la base) ? */
export const isAvailable = (member: Member, task: Pick<PlannedTask, "windowStart" | "windowEnd" | "durationMin">, absences: Absence[]) =>
  freeMinutes(member, task.windowStart, task.windowEnd, absences) >= task.durationMin;

const OPEN: string[] = ["assigned", "in_progress", "to_redo", "unassigned"];

export interface AvailabilityConflict {
  taskId: string;
  memberId: string | null;
  /** accepted : la mission ne tient plus ; pending : elle ne tiendrait plus si la demande est acceptée ; closure : fermeture d'équipe. */
  kind: "accepted" | "pending" | "closure";
  absenceIds: string[];
}

/** Missions à réorganiser à cause d'une absence ou d'une fermeture (jamais modifiées automatiquement). */
export function availabilityConflicts(tasks: PlannedTask[], members: Member[], absences: Absence[], now: Date): AvailabilityConflict[] {
  const out: AvailabilityConflict[] = [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const overlapping = (t: PlannedTask, a: Absence) => ms(a.startsAt) < ms(t.windowEnd) && ms(a.endsAt) > ms(t.windowStart);
  for (const t of tasks) {
    if (!OPEN.includes(t.status) || ms(t.windowEnd) <= now.getTime()) continue;
    const closures = absences.filter((a) => a.scope === "team" && a.status === "accepted" && overlapping(t, a));
    const m = t.assigneeId ? byId.get(t.assigneeId) : undefined;
    if (m) {
      if (!isAvailable(m, t, absences)) {
        const ids = absences.filter((a) => a.status === "accepted" && concerns(a, m) && overlapping(t, a)).map((a) => a.id);
        out.push({ taskId: t.id, memberId: m.id, kind: ids.length > 0 && ids.every((id) => closures.some((c) => c.id === id)) ? "closure" : "accepted", absenceIds: ids });
        continue;
      }
      if (freeMinutes(m, t.windowStart, t.windowEnd, absences, ["accepted", "pending"]) < t.durationMin) {
        out.push({ taskId: t.id, memberId: m.id, kind: "pending", absenceIds: absences.filter((a) => a.status === "pending" && concerns(a, m) && overlapping(t, a)).map((a) => a.id) });
      }
    } else if (closures.length) {
      // Mission sans personne pendant une fermeture d'équipe : à signaler aussi
      out.push({ taskId: t.id, memberId: null, kind: "closure", absenceIds: closures.map((c) => c.id) });
    }
  }
  return out;
}

/** Arrivées et départs de voyageurs pendant une fermeture (une intervention peut être nécessaire). */
export function staysDuringClosures<S extends { id: string; checkInAt: string; checkOutAt: string }>(stays: S[], absences: Absence[]) {
  const closures = absences.filter((a) => a.scope === "team" && a.status === "accepted" && a.teamPosition == null);
  const inside = (iso: string, a: Absence) => ms(iso) >= ms(a.startsAt) && ms(iso) < ms(a.endsAt);
  return stays.filter((s) => closures.some((a) => inside(s.checkInAt, a) || inside(s.checkOutAt, a)));
}
