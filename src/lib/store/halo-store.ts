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
import { DEFAULT_LINEN_SETTINGS, applyPlan, buildDemoData, defaultGuide, defaultLinenTypes, newToken, type HaloData } from "./seed";

export type NewProperty = Omit<Property, "id" | "createdAt" | "archived" | "feeds" | "guide" | "linenParLevel" | "amenities" | "customAmenities"> &
  Partial<Pick<Property, "guide" | "linenParLevel" | "amenities" | "customAmenities">>;
export type NewAlert = Omit<Alert, "id" | "status" | "createdAt" | "photoIds"> & { photoIds?: string[] };
export type NewReservation = Omit<Reservation, "id" | "status"> & { status?: Reservation["status"] };
export type NewService = Omit<ServiceRequest, "id" | "createdAt" | "status"> & { status?: ServiceRequest["status"] };
export type NewTask = Pick<Task, "propertyId" | "type" | "windowStart" | "windowEnd" | "durationMin"> &
  Partial<Pick<Task, "assigneeId" | "scheduledStart" | "notes" | "priority" | "title">>;

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
  setTaskStatus: (id: string, status: TaskStatus) => void;
  applyAssignments: (list: { taskId: string; agentId: string; scheduledStart: string }[]) => void;
  /** Durée prévue fixée à la main (le moteur ne la recalcule plus). */
  setTaskDuration: (id: string, minutes: number) => void;
  /** Met à jour le rapport de mission de l'agent (cases cochées, photos, état des pièces). */
  updateTaskReport: (id: string, update: (report: TaskReport) => TaskReport) => void;
  /** Fin de mission : pointage, pièces sans état → RAS, chaque anomalie devient une alerte. */
  finishTask: (id: string, reporterName?: string) => number;

  addService: (input: NewService) => string;
  updateService: (id: string, patch: Partial<ServiceRequest>) => void;

  addAlert: (input: NewAlert) => string;
  updateAlert: (id: string, patch: Partial<Alert>) => void;
  /** Crée une mission de suivi (intervention) liée à une alerte. */
  createFollowUp: (alertId: string, windowStart: string, windowEnd: string) => string | null;
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
      setTaskStatus: (id, status) =>
        set((s) => ({
          linenMovements: (() => {
            // Fin d'un ménage : le linge du logement part au sale, le kit neuf est posé (une seule fois)
            const task = s.tasks.find((x) => x.id === id);
            const property = task && s.properties.find((p) => p.id === task.propertyId);
            if (!task || !property || status !== "done" || task.type !== "turnover") return s.linenMovements;
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
            // Reprise : le premier passage est conservé à part, un nouveau pointage commence
            if (status === "in_progress" && x.status === "to_redo") {
              const first = actualMinutes(x) ?? 0;
              return { ...x, status, previousWorkMin: (x.previousWorkMin ?? 0) + first, startedAt: stamp, completedAt: undefined };
            }
            return {
              ...x,
              status,
              startedAt: status === "in_progress" ? x.startedAt ?? stamp : x.startedAt,
              completedAt: status === "done" ? stamp : x.completedAt,
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
      finishTask: (id, reporterName) => {
        const task = get().tasks.find((x) => x.id === id);
        const property = task && get().properties.find((p) => p.id === task.propertyId);
        if (!task || !property) return 0;
        const report = task.report ?? emptyReport();
        const rooms = { ...report.rooms };
        let created = 0;
        for (const room of property.checklist) {
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
        get().setTaskStatus(id, "done");
        return created;
      },

      addService: (input) => {
        const id = newId("svc");
        set((s) => ({ services: [{ status: "requested", ...input, id, createdAt: new Date().toISOString() }, ...s.services] }));
        return id;
      },
      updateService: (id, patch) => set((s) => ({ services: s.services.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),

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
      createFollowUp: (alertId, windowStart, windowEnd) => {
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
        get().updateAlert(alertId, { followUpTaskId: taskId, status: "in_progress" });
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
    }),
    {
      name: "halo-demo-v1",
      version: 3,
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
