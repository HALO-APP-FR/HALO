"use client";

/**
 * Magasin de données HALO — MODE DÉMO : enregistré dans le navigateur.
 * En phase 2, chaque action ci-dessous devient un appel Supabase (Server Action),
 * avec la même signature : les écrans ne changent pas.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type {
  Alert,
  CalendarFeed,
  LaundryOrderLine,
  LinenLocationId,
  LinenMovement,
  LinenSettings,
  LinenType,
  Member,
  Property,
  Reservation,
  RoomStatus,
  ServiceRequest,
  Task,
  TaskReport,
  TaskEvent,
  TaskEventKind,
  TaskStatus,
} from "@/lib/domain/types";
import { newId } from "@/lib/domain/templates";
import type { ParsedEvent } from "@/lib/engine/ical";
import {
  kitForTask,
  laundryReceiveMovements,
  laundrySendMovements,
  qtyAt,
  stockFromMovements,
  turnoverMovements,
} from "@/lib/engine/linen";
import { actualMinutes, withLearnedDuration } from "@/lib/engine/learning";
import { planTasks } from "@/lib/engine/tasks";
import type { MapsApp } from "@/lib/engine/directions";
import { CRITICAL_KINDS, type NotificationKind } from "@/lib/engine/notifications";
import {
  canRequestCorrection,
  canStart,
  canSubmit,
  canValidate,
  checklistApplies,
  needsValidation,
  type ReviewCheck,
  type StartCheck,
  type SubmitCheck,
} from "@/lib/engine/mission-cycle";
import { DEFAULT_LINEN_SETTINGS, applyPlan, buildDemoData, defaultGuide, defaultLinenTypes, newToken, type HaloData } from "./seed";

export type NewProperty = Omit<Property, "id" | "createdAt" | "archived" | "feeds" | "guide" | "linenParLevel" | "amenities" | "customAmenities"> &
  Partial<Pick<Property, "guide" | "linenParLevel" | "amenities" | "customAmenities">>;
export type NewAlert = Omit<Alert, "id" | "status" | "createdAt" | "photoIds"> & { photoIds?: string[] };
export type NewReservation = Omit<Reservation, "id" | "status"> & { status?: Reservation["status"] };
export type NewService = Omit<ServiceRequest, "id" | "createdAt" | "status"> & { status?: ServiceRequest["status"] };
export type NewTask = Pick<Task, "propertyId" | "type" | "windowStart" | "windowEnd" | "durationMin"> &
  Partial<Pick<Task, "assigneeId" | "scheduledStart" | "notes" | "priority" | "title" | "nextReservationId" | "reservationId">>;

interface HaloState extends HaloData {
  seeded: boolean;
  ensureSeeded: (locale: string) => void;
  resetDemo: (locale: string) => void;
  /** Repart de zéro : garde l'organisation et le propriétaire, supprime tout le reste. */
  startEmpty: () => void;
  updateOrg: (patch: Partial<HaloData["org"]>) => void;
  refreshTasks: () => void;

  addProperty: (input: NewProperty) => string;
  updateProperty: (id: string, patch: Partial<Property>) => void;
  setArchived: (id: string, archived: boolean) => void;

  addReservation: (input: NewReservation) => string;
  updateReservation: (id: string, patch: Partial<Reservation>) => void;
  cancelReservation: (id: string) => void;
  /** Le voyageur signale son départ (livret) : le ménage peut démarrer. */
  markDeparted: (reservationId: string) => void;

  addFeed: (propertyId: string, feed: Omit<CalendarFeed, "id">) => string;
  removeFeed: (propertyId: string, feedId: string) => void;
  importFeed: (propertyId: string, feedId: string, events: ParsedEvent[] | null, error?: string) => { added: number; updated: number; cancelled: number };

  addTask: (input: NewTask) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  assignTask: (id: string, agentId: string | undefined, scheduledStart?: string) => void;
  /** Changement de statut bas niveau, toujours tracé dans l'historique. */
  setTaskStatus: (id: string, status: TaskStatus, by?: string) => void;
  /** Crée le ménage manquant d'un séjour, relié à lui : de la fin du séjour précédent (ou maintenant) jusqu'à l'arrivée. */
  createCleaningForStay: (stayId: string) => string | null;
  /** Cycle de mission : chaque action vérifie qui agit et dans quel état est la mission. */
  startTask: (id: string, memberId: string | undefined) => StartCheck;
  submitTask: (id: string, memberId: string | undefined) => SubmitCheck & { alerts?: number; status?: TaskStatus };
  validateTask: (id: string, managerId: string | undefined) => ReviewCheck;
  requestCorrection: (id: string, managerId: string | undefined, reason: string) => ReviewCheck;
  applyAssignments: (list: { taskId: string; agentId: string; scheduledStart: string }[]) => void;
  /** Durée prévue fixée à la main (le moteur ne la recalcule plus). */
  setTaskDuration: (id: string, minutes: number) => void;
  /** Met à jour le rapport de mission de l'agent (cases cochées, photos, état des pièces). */
  updateTaskReport: (id: string, update: (report: TaskReport) => TaskReport) => void;
  /** Fin de mission (interne, appelée par submitTask) : pièces sans état → RAS, chaque anomalie devient une alerte. */
  finishTask: (id: string, reporterName?: string, finalStatus?: TaskStatus) => number;

  addService: (input: NewService) => string;
  updateService: (id: string, patch: Partial<ServiceRequest>) => void;
  /** Accepter, refuser, demander des précisions, réaliser, annuler : tracé avec l'auteur et la note. */
  setServiceStatus: (id: string, status: ServiceRequest["status"], by?: string, note?: string) => void;

  addAlert: (input: NewAlert) => string;
  updateAlert: (id: string, patch: Partial<Alert>) => void;
  /** Crée une mission de suivi (intervention) liée à une alerte. */
  createFollowUp: (alertId: string, windowStart: string, windowEnd: string, by?: string) => string | null;
  /** Prise en charge, résolution (note obligatoire) et réouverture, toutes tracées. */
  takeChargeAlert: (id: string, by?: string) => void;
  resolveAlert: (id: string, by: string | undefined, note: string, photoIds?: string[]) => boolean;
  reopenAlert: (id: string, by?: string) => void;
  regenerateGuideToken: (propertyId: string) => void;

  addLinenType: (input: Omit<LinenType, "id">) => string;
  updateLinenType: (id: string, patch: Partial<LinenType>) => void;
  /** Achat de linge neuf (entre dans le stock propre). */
  purchaseLinen: (linenTypeId: string, qty: number) => void;
  /** Inventaire : fixe la quantité réelle d'un emplacement (mouvement d'ajustement). */
  adjustLinen: (location: LinenLocationId, linenTypeId: string, countedQty: number, note?: string) => void;
  createLaundryOrder: (lines: LaundryOrderLine[]) => string;
  updateLaundryOrder: (id: string, lines: LaundryOrderLine[]) => void;
  deleteLaundryOrder: (id: string) => void;
  sendLaundryOrder: (id: string) => void;
  receiveLaundryOrder: (id: string, lines: LaundryOrderLine[]) => void;
  updateLinenSettings: (patch: Partial<LinenSettings>) => void;

  addMember: (input: Omit<Member, "id" | "active">) => string;
  updateMember: (id: string, patch: Partial<Member>) => void;
  setCurrentAgent: (id: string) => void;
  /** Application d'itinéraire par défaut de la personne (démo : cet appareil). Vide = demander. */
  mapsApp?: MapsApp;
  setMapsApp: (app: MapsApp | undefined) => void;
  /** Notifications dans l'application : clés déjà lues et types désactivés (démo : cet appareil). */
  inboxRead: string[];
  markRead: (keys: string[]) => void;
  notificationMuted: NotificationKind[];
  setNotificationMuted: (kind: NotificationKind, muted: boolean) => void;
}

/** Stockage du navigateur protégé : en navigation privée ou bloqué, on garde en mémoire. */
const memory = new Map<string, string>();
const safeStorage: StateStorage = {
  getItem: (k) => {
    try {
      return window.localStorage.getItem(k) ?? memory.get(k) ?? null;
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k, v) => {
    memory.set(k, v);
    try {
      window.localStorage.setItem(k, v);
    } catch {
      /* quota ou stockage bloqué : la mémoire suffit pour la session */
    }
  },
  removeItem: (k) => {
    memory.delete(k);
    try {
      window.localStorage.removeItem(k);
    } catch {
      /* ignoré */
    }
  },
};

const EMPTY: HaloData = {
  org: { name: "", countryCode: "FR", timezone: "Europe/Paris" },
  members: [],
  properties: [],
  reservations: [],
  tasks: [],
  alerts: [],
  linenTypes: [],
  linenMovements: [],
  laundryOrders: [],
  linenSettings: DEFAULT_LINEN_SETTINGS,
  services: [],
  currentAgentId: "",
};

export const emptyReport = (): TaskReport => ({ checked: [], photos: {}, rooms: {} });

const ROOM_ALERT: Record<Exclude<RoomStatus, "ok">, Alert["category"]> = {
  damage: "damage",
  missing: "missing_item",
  dirty: "cleanliness",
  other: "other",
};

const EVENT_FOR: Partial<Record<TaskStatus, TaskEventKind>> = {
  in_progress: "started",
  done: "submitted",
  validated: "validated",
  to_redo: "correction_requested",
  cancelled: "cancelled",
};

function withEvent(task: Task, status: TaskStatus, by?: string, note?: string): TaskEvent[] | undefined {
  if (task.status === status) return task.events;
  const kind: TaskEventKind | undefined = status === "validated" && task.status === "in_progress" ? "auto_validated" : EVENT_FOR[status];
  if (!kind) return task.events;
  return [...(task.events ?? []), { at: new Date().toISOString(), kind, by, ...(note ? { note } : {}) }];
}

function regenerate(state: HaloData, propertyIds?: string[]): Pick<HaloData, "tasks"> {
  const now = new Date();
  let tasks = state.tasks;
  for (const p of state.properties) {
    if (propertyIds && !propertyIds.includes(p.id)) continue;
    if (p.archived) continue;
    // Durée de ménage apprise des pointages réels (si activée pour ce logement)
    tasks = applyPlan(tasks, planTasks(withLearnedDuration(p, tasks), state.reservations, tasks, now), now.toISOString());
  }
  return { tasks };
}

export const useHalo = create<HaloState>()(
  persist(
    (set, get) => ({
      ...EMPTY,
      seeded: false,

      ensureSeeded: (locale) => {
        if (get().seeded) return;
        set({ ...buildDemoData(new Date(), locale), seeded: true });
      },
      resetDemo: (locale) => set({ ...buildDemoData(new Date(), locale), seeded: true }),
      refreshTasks: () => set((s) => regenerate(s)),
      startEmpty: () =>
        set((s) => ({
          members: s.members.filter((m) => m.role === "owner"),
          properties: [],
          reservations: [],
          tasks: [],
          alerts: [],
          linenTypes: defaultLinenTypes(),
          linenMovements: [],
          laundryOrders: [],
          services: [],
          currentAgentId: "",
          seeded: true,
        })),
      updateOrg: (patch) => set((s) => ({ org: { ...s.org, ...patch } })),

      addProperty: (input) => {
        const id = newId("prop");
        set((s) => {
          const properties = [
            ...s.properties,
            {
              amenities: [],
              customAmenities: [],
              linenParLevel: 3,
              ...input,
              guide: input.guide ?? defaultGuide(),
              id,
              archived: false,
              feeds: [],
              createdAt: new Date().toISOString(),
            },
          ];
          return { properties, ...regenerate({ ...s, properties }, [id]) };
        });
        return id;
      },
      updateProperty: (id, patch) =>
        set((s) => {
          const properties = s.properties.map((p) => (p.id === id ? { ...p, ...patch } : p));
          return { properties, ...regenerate({ ...s, properties }, [id]) };
        }),
      setArchived: (id, archived) =>
        set((s) => ({ properties: s.properties.map((p) => (p.id === id ? { ...p, archived } : p)) })),

      addReservation: (input) => {
        const id = newId("res");
        set((s) => {
          const reservations = [...s.reservations, { status: "confirmed" as const, ...input, id }];
          return { reservations, ...regenerate({ ...s, reservations }, [input.propertyId]) };
        });
        return id;
      },
      updateReservation: (id, patch) =>
        set((s) => {
          const target = s.reservations.find((r) => r.id === id);
          const reservations = s.reservations.map((r) => (r.id === id ? { ...r, ...patch } : r));
          return { reservations, ...regenerate({ ...s, reservations }, target ? [target.propertyId] : undefined) };
        }),
      cancelReservation: (id) => get().updateReservation(id, { status: "cancelled" }),
      markDeparted: (reservationId) => get().updateReservation(reservationId, { departedAt: new Date().toISOString() }),

      addFeed: (propertyId, feed) => {
        const id = newId("feed");
        set((s) => ({
          properties: s.properties.map((p) => (p.id === propertyId ? { ...p, feeds: [...p.feeds, { ...feed, id }] } : p)),
        }));
        return id;
      },
      removeFeed: (propertyId, feedId) =>
        set((s) => {
          const properties = s.properties.map((p) =>
            p.id === propertyId ? { ...p, feeds: p.feeds.filter((f) => f.id !== feedId) } : p,
          );
          // Les séjours futurs venant de ce calendrier disparaissent avec lui
          const now = Date.now();
          const reservations = s.reservations.map((r) =>
            r.feedId === feedId && new Date(r.checkOutAt).getTime() > now ? { ...r, status: "cancelled" as const } : r,
          );
          return { properties, reservations, ...regenerate({ ...s, properties, reservations }, [propertyId]) };
        }),

      importFeed: (propertyId, feedId, events, error) => {
        const counts = { added: 0, updated: 0, cancelled: 0 };
        set((s) => {
          const stamp = new Date().toISOString();
          const touchFeed = (patch: Partial<CalendarFeed>) =>
            s.properties.map((p) =>
              p.id === propertyId ? { ...p, feeds: p.feeds.map((f) => (f.id === feedId ? { ...f, ...patch } : f)) } : p,
            );
          // Échec : on garde tout, on note l'erreur (docs/04 §1)
          if (!events) return { properties: touchFeed({ lastError: error ?? "error" }) };

          const feed = s.properties.find((p) => p.id === propertyId)?.feeds.find((f) => f.id === feedId);
          const seen = new Set<string>();
          let reservations = [...s.reservations];
          for (const ev of events) {
            seen.add(ev.uid);
            const idx = reservations.findIndex((r) => r.feedId === feedId && r.externalUid === ev.uid);
            const data = {
              checkInAt: ev.checkInAt,
              checkOutAt: ev.checkOutAt,
              status: ev.status,
              guestName: ev.guestName,
            };
            if (idx < 0) {
              reservations.push({ id: newId("res"), propertyId, feedId, externalUid: ev.uid, source: feed?.source ?? "other", ...data });
              counts.added += 1;
            } else {
              const r = reservations[idx];
              if (r.checkInAt !== data.checkInAt || r.checkOutAt !== data.checkOutAt || r.status !== data.status) {
                reservations[idx] = { ...r, ...data };
                counts.updated += 1;
              }
            }
          }
          // Disparu du calendrier et pas encore terminé → annulé
          const now = Date.now();
          reservations = reservations.map((r) => {
            if (r.feedId !== feedId || seen.has(r.externalUid ?? "") || r.status === "cancelled") return r;
            if (new Date(r.checkOutAt).getTime() <= now) return r;
            counts.cancelled += 1;
            return { ...r, status: "cancelled" as const };
          });
          const properties = touchFeed({ lastSyncedAt: stamp, lastError: undefined });
          return { properties, reservations, ...regenerate({ ...s, properties, reservations }, [propertyId]) };
        });
        return counts;
      },

      addTask: (input) => {
        const id = newId("task");
        set((s) => ({
          tasks: [
            ...s.tasks,
            {
              priority: "normal",
              ...input,
              id,
              isAutoGenerated: false,
              status: input.assigneeId ? "assigned" : "unassigned",
              createdAt: new Date().toISOString(),
            },
          ],
        }));
        return id;
      },
      updateTask: (id, patch) => set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      assignTask: (id, agentId, scheduledStart) =>
        set((s) => ({
          tasks: s.tasks.map((x) => {
            if (x.id !== id) return x;
            const status: TaskStatus =
              x.status === "unassigned" || x.status === "assigned" ? (agentId ? "assigned" : "unassigned") : x.status;
            return { ...x, assigneeId: agentId, scheduledStart: agentId ? scheduledStart ?? x.scheduledStart : undefined, status };
          }),
        })),
      setTaskStatus: (id, status, by) =>
        set((s) => ({
          linenMovements: (() => {
            // Fin d'un ménage : le linge du logement part au sale, le kit neuf est posé (une seule fois)
            const task = s.tasks.find((x) => x.id === id);
            const property = task && s.properties.find((p) => p.id === task.propertyId);
            if (!task || !property || (status !== "done" && status !== "validated") || task.type !== "turnover") return s.linenMovements;
            if (s.linenMovements.some((m) => m.taskId === id)) return s.linenMovements;
            const kit = kitForTask(task, property, s.linenTypes);
            return [
              ...s.linenMovements,
              ...turnoverMovements(task, kit, stockFromMovements(s.linenMovements), new Date().toISOString(), () => newId("mv")),
            ];
          })(),
          tasks: s.tasks.map((x) => {
            if (x.id !== id) return x;
            const stamp = new Date().toISOString();
            const events = withEvent(x, status, by);
            // Reprise : le premier passage est conservé à part, un nouveau pointage commence
            if (status === "in_progress" && x.status === "to_redo") {
              const first = actualMinutes(x) ?? 0;
              return { ...x, status, events, previousWorkMin: (x.previousWorkMin ?? 0) + first, startedAt: stamp, completedAt: undefined };
            }
            const submitted = (status === "done" || status === "validated") && x.status === "in_progress";
            return {
              ...x,
              status,
              events,
              startedAt: status === "in_progress" ? x.startedAt ?? stamp : x.startedAt,
              completedAt: submitted ? stamp : x.completedAt,
              validatedAt: status === "validated" ? stamp : status === "to_redo" ? undefined : x.validatedAt,
            };
          }),
        })),
      applyAssignments: (list) =>
        set((s) => ({
          tasks: s.tasks.map((x) => {
            const a = list.find((l) => l.taskId === x.id);
            return a ? { ...x, assigneeId: a.agentId, scheduledStart: a.scheduledStart, status: "assigned" } : x;
          }),
        })),

      setTaskDuration: (id, minutes) =>
        set((s) => ({
          tasks: s.tasks.map((x) => (x.id === id ? { ...x, durationMin: Math.max(15, Math.min(600, Math.round(minutes))), durationLocked: true } : x)),
        })),
      updateTaskReport: (id, update) =>
        set((s) => ({ tasks: s.tasks.map((x) => (x.id === id ? { ...x, report: update(x.report ?? emptyReport()) } : x)) })),
      createCleaningForStay: (stayId) => {
        const s = get();
        const stay = s.reservations.find((r) => r.id === stayId && r.status === "confirmed");
        if (!stay) return null;
        const existing = s.tasks.find((x) => x.type === "turnover" && x.nextReservationId === stayId && x.status !== "cancelled");
        if (existing) return existing.id; // jamais de doublon
        const property = s.properties.find((p) => p.id === stay.propertyId);
        const previous = s.reservations
          .filter((r) => r.propertyId === stay.propertyId && r.status === "confirmed" && r.id !== stay.id && r.checkOutAt <= stay.checkInAt)
          .sort((a, b) => b.checkOutAt.localeCompare(a.checkOutAt))[0];
        const arrival = new Date(stay.checkInAt).getTime();
        const from = previous ? new Date(previous.checkOutAt).getTime() : Date.now();
        const start = from < arrival ? from : arrival - 4 * 3_600_000;
        return get().addTask({
          propertyId: stay.propertyId,
          type: "turnover",
          windowStart: new Date(start).toISOString(),
          windowEnd: stay.checkInAt,
          durationMin: property?.cleaningDurationMin ?? 90,
          nextReservationId: stay.id,
          reservationId: previous?.id,
        });
      },
      startTask: (id, memberId) => {
        const task = get().tasks.find((x) => x.id === id);
        if (!task) return { ok: false, reason: "bad_status" };
        const check = canStart(task, memberId);
        if (!check.ok) return check;
        get().setTaskStatus(id, "in_progress", get().members.find((m) => m.id === memberId)?.name);
        return check;
      },
      submitTask: (id, memberId) => {
        const s0 = get();
        const task = s0.tasks.find((x) => x.id === id);
        const property = task && s0.properties.find((p) => p.id === task.propertyId);
        if (!task || !property) return { ok: false, reason: "bad_status" };
        const check = canSubmit(task, property, memberId);
        if (!check.ok) return check;
        const status: TaskStatus = needsValidation(task.type, s0.org.validationTaskTypes) ? "done" : "validated";
        const name = s0.members.find((m) => m.id === memberId)?.name;
        const alerts = get().finishTask(id, name, status);
        return { ok: true, alerts, status };
      },
      validateTask: (id, managerId) => {
        const task = get().tasks.find((x) => x.id === id);
        const by = get().members.find((m) => m.id === managerId);
        if (!task) return { ok: false, reason: "bad_status" };
        const check = canValidate(task, by, get().properties.find((p) => p.id === task.propertyId));
        if (!check.ok) return check;
        get().setTaskStatus(id, "validated", by?.name);
        return check;
      },
      requestCorrection: (id, managerId, reason) => {
        const task = get().tasks.find((x) => x.id === id);
        const by = get().members.find((m) => m.id === managerId);
        if (!task) return { ok: false, reason: "bad_status" };
        const check = canRequestCorrection(task, by, reason);
        if (!check.ok) return check;
        const note = reason.trim();
        const at = new Date().toISOString();
        set((s) => ({
          tasks: s.tasks.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status: "to_redo" as const,
                  correctionReason: note,
                  validatedAt: undefined,
                  events: withEvent(x, "to_redo", by?.name, note),
                  // Le compte rendu soumis est conservé tel quel ; l'agent repart de cette base
                  reportHistory: [...(x.reportHistory ?? []), { report: x.report ?? emptyReport(), startedAt: x.startedAt, completedAt: x.completedAt, archivedAt: at }],
                }
              : x,
          ),
        }));
        return check;
      },
      finishTask: (id, reporterName, finalStatus = "done") => {
        const task = get().tasks.find((x) => x.id === id);
        const property = task && get().properties.find((p) => p.id === task.propertyId);
        if (!task || !property) return 0;
        const report = task.report ?? emptyReport();
        const rooms = { ...report.rooms };
        let created = 0;
        for (const room of checklistApplies(task) ? property.checklist : []) {
          const r = rooms[room.id] ?? {};
          if (!r.status) {
            rooms[room.id] = { ...r, status: "ok" };
            continue;
          }
          if (r.status === "ok") continue;
          get().addAlert({
            propertyId: property.id,
            taskId: task.id,
            reservationId: task.reservationId,
            source: "agent",
            reporterName,
            category: ROOM_ALERT[r.status],
            location: { kind: "room", ref: room.id, label: room.name },
            description: r.comment?.trim() || room.name,
            urgent: false,
            photoIds: r.photoIds ?? [],
          });
          created += 1;
        }
        get().updateTaskReport(id, () => ({ ...report, rooms }));
        get().setTaskStatus(id, finalStatus, reporterName);
        return created;
      },

      addService: (input) => {
        const id = newId("svc");
        set((s) => ({ services: [{ status: "requested", ...input, id, createdAt: new Date().toISOString() }, ...s.services] }));
        return id;
      },
      updateService: (id, patch) => set((s) => ({ services: s.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
      setServiceStatus: (id, status, by, note) =>
        set((s) => ({
          services: s.services.map((x) =>
            x.id === id
              ? {
                  ...x,
                  status,
                  statusNote: note?.trim() || undefined,
                  history: [...(x.history ?? []), { at: new Date().toISOString(), status, by, ...(note?.trim() ? { note: note.trim() } : {}) }],
                }
              : x,
          ),
        })),

      addAlert: (input) => {
        const id = newId("alert");
        set((s) => ({
          alerts: [{ photoIds: [], ...input, id, status: "open", createdAt: new Date().toISOString() }, ...s.alerts],
        }));
        return id;
      },
      updateAlert: (id, patch) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  ...patch,
                  resolvedAt: patch.status === "resolved" ? new Date().toISOString() : patch.status ? undefined : a.resolvedAt,
                }
              : a,
          ),
        })),
      takeChargeAlert: (id, by) => {
        const at = new Date().toISOString();
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id && a.status === "open"
              ? { ...a, status: "in_progress", takenAt: at, takenBy: by, history: [...(a.history ?? []), { at, kind: "taken", by }] }
              : a,
          ),
        }));
      },
      resolveAlert: (id, by, note, photoIds = []) => {
        // Une alerte n'est jamais « traitée » sans dire ce qui a été fait
        if (!note.trim()) return false;
        const at = new Date().toISOString();
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? {
                  ...a,
                  status: "resolved",
                  resolution: note.trim(),
                  resolutionPhotoIds: photoIds,
                  resolvedAt: at,
                  resolvedBy: by,
                  history: [...(a.history ?? []), { at, kind: "resolved", by, note: note.trim() }],
                }
              : a,
          ),
        }));
        return true;
      },
      reopenAlert: (id, by) => {
        const at = new Date().toISOString();
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id
              ? { ...a, status: "in_progress", resolvedAt: undefined, resolvedBy: undefined, history: [...(a.history ?? []), { at, kind: "reopened", by }] }
              : a,
          ),
        }));
      },
      createFollowUp: (alertId, windowStart, windowEnd, by) => {
        const alert = get().alerts.find((a) => a.id === alertId);
        if (!alert) return null;
        const taskId = get().addTask({
          propertyId: alert.propertyId,
          type: "inspection",
          windowStart,
          windowEnd,
          durationMin: 60,
          priority: alert.urgent ? "urgent" : "normal",
          notes: [alert.location?.label, alert.description].filter(Boolean).join(" — "),
        });
        const at = new Date().toISOString();
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === alertId
              ? {
                  ...a,
                  followUpTaskId: taskId,
                  status: "in_progress",
                  takenAt: a.takenAt ?? at,
                  takenBy: a.takenBy ?? by,
                  history: [...(a.history ?? []), { at, kind: "follow_up", by }],
                }
              : a,
          ),
        }));
        return taskId;
      },
      regenerateGuideToken: (propertyId) =>
        set((s) => ({
          properties: s.properties.map((p) => (p.id === propertyId ? { ...p, guide: { ...p.guide, token: newToken() } } : p)),
        })),

      addLinenType: (input) => {
        const id = newId("linen");
        set((s) => ({ linenTypes: [...s.linenTypes, { ...input, id }] }));
        return id;
      },
      updateLinenType: (id, patch) => set((s) => ({ linenTypes: s.linenTypes.map((t) => (t.id === id ? { ...t, ...patch } : t)) })),
      purchaseLinen: (linenTypeId, qty) =>
        set((s) => ({
          linenMovements: [
            ...s.linenMovements,
            { id: newId("mv"), linenTypeId, to: "clean", qty, reason: "purchase", createdAt: new Date().toISOString() },
          ],
        })),
      adjustLinen: (location, linenTypeId, countedQty, note) =>
        set((s) => {
          const current = qtyAt(stockFromMovements(s.linenMovements), location, linenTypeId);
          const delta = countedQty - current;
          if (delta === 0) return {};
          const mv: LinenMovement = {
            id: newId("mv"),
            linenTypeId,
            ...(delta > 0 ? { to: location } : { from: location }),
            qty: Math.abs(delta),
            reason: "adjustment",
            note,
            createdAt: new Date().toISOString(),
          };
          return { linenMovements: [...s.linenMovements, mv] };
        }),
      createLaundryOrder: (lines) => {
        const id = newId("order");
        set((s) => ({
          laundryOrders: [
            {
              id,
              reference: `B-${String(s.laundryOrders.length + 1).padStart(4, "0")}`,
              status: "draft",
              lines: lines.filter((l) => l.sent > 0),
              createdAt: new Date().toISOString(),
            },
            ...s.laundryOrders,
          ],
        }));
        return id;
      },
      updateLaundryOrder: (id, lines) =>
        set((s) => ({ laundryOrders: s.laundryOrders.map((o) => (o.id === id && o.status === "draft" ? { ...o, lines } : o)) })),
      deleteLaundryOrder: (id) => set((s) => ({ laundryOrders: s.laundryOrders.filter((o) => !(o.id === id && o.status === "draft")) })),
      sendLaundryOrder: (id) =>
        set((s) => {
          const order = s.laundryOrders.find((o) => o.id === id);
          if (!order || order.status !== "draft") return {};
          const now = new Date();
          // On n'envoie jamais plus que le sale disponible
          const stock = stockFromMovements(s.linenMovements);
          const lines = order.lines
            .map((l) => ({ ...l, sent: Math.min(l.sent, Math.max(0, qtyAt(stock, "dirty", l.linenTypeId))) }))
            .filter((l) => l.sent > 0);
          const sent = {
            ...order,
            lines,
            status: "sent" as const,
            sentAt: now.toISOString(),
            expectedAt: new Date(now.getTime() + s.linenSettings.turnaroundDays * 86_400_000).toISOString(),
          };
          return {
            laundryOrders: s.laundryOrders.map((o) => (o.id === id ? sent : o)),
            linenMovements: [...s.linenMovements, ...laundrySendMovements(sent, now.toISOString(), () => newId("mv"))],
          };
        }),
      receiveLaundryOrder: (id, lines) =>
        set((s) => {
          const order = s.laundryOrders.find((o) => o.id === id);
          if (!order || order.status !== "sent") return {};
          const received = { ...order, lines, status: "received" as const, receivedAt: new Date().toISOString() };
          return {
            laundryOrders: s.laundryOrders.map((o) => (o.id === id ? received : o)),
            linenMovements: [...s.linenMovements, ...laundryReceiveMovements(received, new Date().toISOString(), () => newId("mv"))],
          };
        }),
      updateLinenSettings: (patch) => set((s) => ({ linenSettings: { ...s.linenSettings, ...patch } })),

      addMember: (input) => {
        const id = newId("member");
        set((s) => ({ members: [...s.members, { ...input, id, active: true }] }));
        return id;
      },
      updateMember: (id, patch) => set((s) => ({ members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
      setCurrentAgent: (id) => set({ currentAgentId: id }),
      setMapsApp: (app) => set({ mapsApp: app }),
      inboxRead: [],
      markRead: (keys) =>
        set((s) => {
          const next = new Set(s.inboxRead);
          for (const k of keys) next.add(k);
          // On garde les 500 dernières clés : les plus anciennes ne correspondent plus à rien d'actif
          return { inboxRead: [...next].slice(-500) };
        }),
      notificationMuted: [],
      setNotificationMuted: (kind, muted) =>
        set((s) => ({
          // Les alertes critiques ne peuvent pas être rendues silencieuses
          notificationMuted: CRITICAL_KINDS.includes(kind) ? s.notificationMuted : muted ? [...new Set([...s.notificationMuted, kind])] : s.notificationMuted.filter((k) => k !== kind),
        })),
    }),
    {
      name: "halo-demo-v1",
      version: 4,
      // v1 → v2 : équipements, livret voyageur, alertes, linge
      migrate: (persisted, version) => {
        const data = persisted as Partial<HaloData> & { seeded?: boolean };
        if (version < 2) {
          data.properties = (data.properties ?? []).map((p) => ({
            ...p,
            amenities: p.amenities ?? [],
            customAmenities: p.customAmenities ?? [],
            guide: p.guide ?? defaultGuide(),
            linenParLevel: p.linenParLevel ?? 3,
          }));
          data.alerts = data.alerts ?? [];
          data.linenTypes = data.linenTypes ?? defaultLinenTypes();
          data.linenMovements = data.linenMovements ?? [];
          data.laundryOrders = data.laundryOrders ?? [];
          data.linenSettings = data.linenSettings ?? DEFAULT_LINEN_SETTINGS;
        }
        // v2 → v3 : postes, prestations, VIP, pointage
        if (version < 3) {
          data.members = (data.members ?? []).map((m) => (m.role === "agent" && !m.position ? { ...m, position: "housekeeper" as const } : m));
          data.services = data.services ?? [];
        }
        // v3 → v4 : cycle de mission (validation configurable, motif de correction séparé)
        if (version < 4) {
          data.org = { ...(data.org ?? EMPTY.org), validationTaskTypes: data.org?.validationTaskTypes ?? ["turnover"] };
          data.tasks = (data.tasks ?? []).map((x) => (x.status === "to_redo" && x.notes && !x.correctionReason ? { ...x, correctionReason: x.notes } : x));
        }
        return data as HaloState;
      },
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
      partialize: (s) => ({
        seeded: s.seeded,
        org: s.org,
        members: s.members,
        properties: s.properties,
        reservations: s.reservations,
        tasks: s.tasks,
        alerts: s.alerts,
        linenTypes: s.linenTypes,
        linenMovements: s.linenMovements,
        laundryOrders: s.laundryOrders,
        linenSettings: s.linenSettings,
        services: s.services,
        currentAgentId: s.currentAgentId,
        mapsApp: s.mapsApp,
        inboxRead: s.inboxRead,
        notificationMuted: s.notificationMuted,
      }),
    },
  ),
);

/** Vrai une fois les données du navigateur chargées (évite tout décalage serveur/navigateur). */
export function useHaloReady() {
  return useSyncExternalStore(
    (cb) => useHalo.persist.onFinishHydration(cb),
    () => useHalo.persist.hasHydrated(),
    () => false,
  );
}
