/**
 * Disponibilités de l'équipe — fonctions PURES, miroir des règles de la base
 * (public.free_minutes_of / check_assignee_available, migration 9).
 *
 * Règles :
 * - seules les absences ACCEPTÉES bloquent (en attente : signalées, refusées / annulées : ignorées) ;
 * - une fermeture d'équipe concerne tout le monde, ou seulement un poste si elle en précise un ;
 * - créneau RÉEL de la mission : l'horaire planifié (+ durée) s'il est fixé, sinon toute sa fenêtre ;
 *   une personne n'est pas proposée dès qu'une absence acceptée ou une fermeture chevauche ce créneau
 *   (une absence partielle qui ne le touche pas ne bloque rien) — retour du 29/10, migration 10 ;
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
  /** Horaire planifié, s'il est fixé : c'est lui qui compte, pas toute la fenêtre. */
  scheduledStart?: string | null;
  /** Début réel (mission démarrée), s'il est connu */
  startedAt?: string | null;
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
/** Créneau réel : [planifié ; planifié + durée] si un horaire est fixé, sinon la fenêtre entière. */
export function slotOf(task: Pick<PlannedTask, "windowStart" | "windowEnd" | "durationMin" | "scheduledStart">) {
  if (task.scheduledStart) return { start: ms(task.scheduledStart), end: ms(task.scheduledStart) + task.durationMin * MINUTE };
  return { start: ms(task.windowStart), end: ms(task.windowEnd) };
}

/** Absences du statut voulu qui chevauchent le créneau réel de la mission (sans juger s'il reste du temps libre). */
export function overlappingAbsences(member: Member, task: Pick<PlannedTask, "windowStart" | "windowEnd" | "durationMin" | "scheduledStart">, absences: Absence[], statuses: AbsenceStatus[] = ["accepted"]) {
  const { start, end } = slotOf(task);
  return absences.filter((a) => statuses.includes(a.status) && concerns(a, member) && ms(a.startsAt) < end && ms(a.endsAt) > start);
}

/**
 * Niveau d'une absence pour une mission (même règle que public.task_absence_level, migration 16) :
 *  - « conflict » : horaire planifié chevauché, ou fenêtre sans horaire où le plus long temps libre
 *    (hors absences) est plus court que la durée prévue → la mission ne peut pas être faite par cette personne ;
 *  - « risk » : absence sur une partie de la fenêtre, mais il reste un temps libre suffisant → à examiner ;
 *  - « none ».
 * Le temps libre est calculé sur 24 h (horaires de travail et trajets non connus de HALO).
 */
export function absenceLevel(
  member: Member,
  task: Pick<PlannedTask, "windowStart" | "windowEnd" | "durationMin" | "scheduledStart">,
  absences: Absence[],
  statuses: AbsenceStatus[] = ["accepted"],
  /** Si fourni et que la fenêtre a déjà commencé, le calcul ne porte que sur le temps restant (de maintenant à la fin de fenêtre). */
  now?: Date,
) {
  const clipped = !task.scheduledStart && now != null && ms(task.windowStart) < now.getTime() && now.getTime() < ms(task.windowEnd);
  const eff = clipped ? { ...task, windowStart: now!.toISOString() } : task;
  /** Période réellement utilisée pour le calcul (affichée telle quelle au responsable) */
  const period = { from: eff.windowStart, to: eff.windowEnd, fromNow: clipped };
  const over = overlappingAbsences(member, eff, absences, statuses);
  if (!over.length) return { level: "none" as const, absences: over, freeMin: null as number | null, period };
  if (task.scheduledStart) return { level: "conflict" as const, absences: over, freeMin: null, period };
  const freeMin = freeMinutes(member, eff.windowStart, eff.windowEnd, absences, statuses);
  return { level: freeMin >= task.durationMin ? ("risk" as const) : ("conflict" as const), absences: over, freeMin, period };
}

/** Absences qui rendent la mission impossible pour cette personne (conflit confirmé, refusé aussi par la base). */
export function blockingAbsences(member: Member, task: Pick<PlannedTask, "windowStart" | "windowEnd" | "durationMin" | "scheduledStart">, absences: Absence[], statuses: AbsenceStatus[] = ["accepted"]) {
  const r = absenceLevel(member, task, absences, statuses);
  return r.level === "conflict" ? r.absences : [];
}

/** La personne peut-elle recevoir cette mission ? Non en cas de conflit confirmé. */
export const isAvailable = (member: Member, task: Pick<PlannedTask, "windowStart" | "windowEnd" | "durationMin" | "scheduledStart">, absences: Absence[]) =>
  blockingAbsences(member, task, absences).length === 0;

const OPEN: string[] = ["assigned", "in_progress", "to_redo", "unassigned"];

export interface AvailabilityConflict {
  taskId: string;
  memberId: string | null;
  /**
   * accepted : la mission ne peut plus être faite par cette personne (conflit confirmé) ;
   * partial : absence sur une partie de la fenêtre, temps libre suffisant (risque à examiner) ;
   * started_during : mission démarrée pendant une absence acceptée (à vérifier) ;
   * started_before : mission démarrée avant une absence qui a commencé depuis ;
   * started_upcoming : mission en cours, absence à venir dans sa fenêtre ;
   * started : mission en cours, absence commencée, heure de démarrage inconnue ;
   * pending : elle ne tiendrait plus si la demande est acceptée ; closure : fermeture d'équipe.
   */
  kind: "accepted" | "partial" | "started" | "started_during" | "started_before" | "started_upcoming" | "pending" | "closure";
  /** Début de la première absence concernée (pour dire « absence prévue le … » sans ambiguïté) */
  absenceStart?: string;
  /** Plus long temps libre continu (minutes) sur la période indiquée, quand il fonde la conclusion */
  freeMin?: number | null;
  /** Période du calcul : de maintenant (fenêtre déjà commencée) ou du début de fenêtre, jusqu'à sa fin */
  period?: { from: string; to: string; fromNow: boolean };
  startedAt?: string | null;
  absenceIds: string[];
}

/** Missions à réorganiser à cause d'une absence ou d'une fermeture (jamais modifiées automatiquement). */
export function availabilityConflicts(tasks: PlannedTask[], members: Member[], absences: Absence[], now: Date): AvailabilityConflict[] {
  const out: AvailabilityConflict[] = [];
  const byId = new Map(members.map((m) => [m.id, m]));
  const overlapping = (t: PlannedTask, a: Absence) => {
    const { start, end } = slotOf(t);
    return ms(a.startsAt) < end && ms(a.endsAt) > start;
  };
  for (const t of tasks) {
    if (!OPEN.includes(t.status) || ms(t.windowEnd) <= now.getTime()) continue;
    const closures = absences.filter((a) => a.scope === "team" && a.status === "accepted" && overlapping(t, a));
    const m = t.assigneeId ? byId.get(t.assigneeId) : undefined;
    if (m) {
      const lv = absenceLevel(m, t, absences, ["accepted"], now);
      if (lv.level !== "none") {
        const ids = lv.absences.map((a) => a.id);
        const first = lv.absences.slice().sort((a, b) => ms(a.startsAt) - ms(b.startsAt))[0];
        let kind: AvailabilityConflict["kind"];
        if (t.status === "in_progress") {
          // Mission en cours : démarrée pendant une absence, avant une absence commencée depuis, ou avant une absence à venir
          const st = t.startedAt ? ms(t.startedAt) : null;
          if (ms(first.startsAt) > now.getTime()) kind = "started_upcoming";
          else if (st == null) kind = "started";
          else if (lv.absences.some((a) => st >= ms(a.startsAt) && st < ms(a.endsAt))) kind = "started_during";
          else kind = "started_before";
        } else {
          kind = lv.level === "risk" ? "partial" : ids.every((id) => closures.some((c) => c.id === id)) ? "closure" : "accepted";
        }
        out.push({ taskId: t.id, memberId: m.id, kind, absenceIds: ids, freeMin: lv.freeMin, period: lv.period, absenceStart: first.startsAt, startedAt: t.startedAt ?? null });
        continue;
      }
      const pending = overlappingAbsences(m, t, absences, ["pending"]);
      if (pending.length) out.push({ taskId: t.id, memberId: m.id, kind: "pending", absenceIds: pending.map((a) => a.id) });
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

/**
 * Classement d'un conflit pour l'affichage (retour du 5/11 : une demande EN ATTENTE apparaissait parmi les
 * « conflits confirmés ») :
 *  - confirmed : la mission ne peut pas être faite par la personne selon les informations connues
 *    (absence ACCEPTÉE qui la rend impossible, fermeture d'équipe) ;
 *  - review : une solution reste possible ou l'état réel est inconnu (absence partielle, mission en cours) ;
 *  - potential : conflit seulement si la demande en attente est acceptée.
 * Une absence refusée ou annulée ne produit aucun conflit.
 */
export type ConflictGroup = "confirmed" | "review" | "potential";
export function conflictGroup(kind: AvailabilityConflict["kind"]): ConflictGroup {
  if (kind === "pending") return "potential";
  if (kind === "accepted" || kind === "closure") return "confirmed";
  return "review";
}
