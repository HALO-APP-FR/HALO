"use client";

/**
 * Magasin de données HALO — MODE DÉMO : enregistré dans le navigateur.
 * En phase 2, chaque action ci-dessous devient un appel Supabase (Server Action),
 * avec la même signature : les écrans ne changent pas.
 */
import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";
import type { CalendarFeed, Member, Property, Reservation, Task, TaskStatus } from "@/lib/domain/types";
import { newId } from "@/lib/domain/templates";
import type { ParsedEvent } from "@/lib/engine/ical";
import { planTasks } from "@/lib/engine/tasks";
import { applyPlan, buildDemoData, type HaloData } from "./seed";

export type NewProperty = Omit<Property, "id" | "createdAt" | "archived" | "feeds">;
export type NewReservation = Omit<Reservation, "id" | "status"> & { status?: Reservation["status"] };
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

  addFeed: (propertyId: string, feed: Omit<CalendarFeed, "id">) => string;
  removeFeed: (propertyId: string, feedId: string) => void;
  importFeed: (propertyId: string, feedId: string, events: ParsedEvent[] | null, error?: string) => { added: number; updated: number; cancelled: number };

  addTask: (input: NewTask) => string;
  updateTask: (id: string, patch: Partial<Task>) => void;
  assignTask: (id: string, agentId: string | undefined, scheduledStart?: string) => void;
  setTaskStatus: (id: string, status: TaskStatus) => void;
  applyAssignments: (list: { taskId: string; agentId: string; scheduledStart: string }[]) => void;

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
  currentAgentId: "",
};

function regenerate(state: HaloData, propertyIds?: string[]): Pick<HaloData, "tasks"> {
  const now = new Date();
  let tasks = state.tasks;
  for (const p of state.properties) {
    if (propertyIds && !propertyIds.includes(p.id)) continue;
    if (p.archived) continue;
    tasks = applyPlan(tasks, planTasks(p, state.reservations, tasks, now), now.toISOString());
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
          currentAgentId: "",
          seeded: true,
        })),
      updateOrg: (patch) => set((s) => ({ org: { ...s.org, ...patch } })),

      addProperty: (input) => {
        const id = newId("prop");
        set((s) => {
          const properties = [...s.properties, { ...input, id, archived: false, feeds: [], createdAt: new Date().toISOString() }];
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
          tasks: s.tasks.map((x) => {
            if (x.id !== id) return x;
            const stamp = new Date().toISOString();
            return {
              ...x,
              status,
              startedAt: status === "in_progress" ? x.startedAt ?? stamp : x.startedAt,
              completedAt: status === "done" ? stamp : x.completedAt,
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
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      skipHydration: true,
      partialize: (s) => ({
        seeded: s.seeded,
        org: s.org,
        members: s.members,
        properties: s.properties,
        reservations: s.reservations,
        tasks: s.tasks,
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
