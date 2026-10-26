/**
 * Données de démonstration (phase 1) — remplacées par Supabase en phase 2.
 * Les instants sont calculés pour « aujourd'hui » dans le fuseau de chaque logement.
 */
import { addDaysToKey, localDateKey, zonedTimeToUtc } from "@/lib/engine/time";

export type TaskType =
  | "turnover"
  | "check_in"
  | "check_out"
  | "linen_delivery"
  | "linen_pickup"
  | "inspection"
  | "other";

export type TaskStatus =
  | "unassigned"
  | "assigned"
  | "in_progress"
  | "done"
  | "to_redo"
  | "validated"
  | "cancelled";

export type TaskPriority = "normal" | "high" | "urgent";

export interface DemoAgent {
  id: string;
  name: string;
  initials: string;
  color: string;
}

export interface DemoProperty {
  id: string;
  name: string;
  area: string;
  city: string;
  timezone: string;
}

export interface DemoTask {
  id: string;
  type: TaskType;
  status: TaskStatus;
  priority: TaskPriority;
  propertyId: string;
  assigneeId: string | null;
  windowStart: Date;
  windowEnd: Date;
  scheduledStart: Date | null;
  durationMin: number;
  guests: number | null;
  sameDayArrival: boolean;
}

export const demoAgents: DemoAgent[] = [
  { id: "a1", name: "Inès Moreau", initials: "IM", color: "#0055FF" },
  { id: "a2", name: "Karim Benali", initials: "KB", color: "#1F9D55" },
  { id: "a3", name: "Lucía Gómez", initials: "LG", color: "#8E4EC6" },
  { id: "a4", name: "Tomás Silva", initials: "TS", color: "#B86E00" },
];

export const demoProperties: DemoProperty[] = [
  { id: "p1", name: "Loft Marais", area: "Paris 3e", city: "Paris", timezone: "Europe/Paris" },
  { id: "p2", name: "Studio Bastille", area: "Paris 11e", city: "Paris", timezone: "Europe/Paris" },
  { id: "p3", name: "Appartement Canal", area: "Paris 10e", city: "Paris", timezone: "Europe/Paris" },
  { id: "p4", name: "Maison Belleville", area: "Paris 20e", city: "Paris", timezone: "Europe/Paris" },
  { id: "p5", name: "Duplex Montmartre", area: "Paris 18e", city: "Paris", timezone: "Europe/Paris" },
  { id: "p6", name: "Casa Alfama", area: "Alfama", city: "Lisboa", timezone: "Europe/Lisbon" },
];

export const DEMO_CURRENT_AGENT_ID = "a1";

export function getDemoDay(now: Date = new Date()) {
  const at = (propertyId: string, time: string, dayOffset = 0) => {
    const p = demoProperties.find((x) => x.id === propertyId)!;
    const key = addDaysToKey(localDateKey(now, p.timezone), dayOffset);
    return zonedTimeToUtc(key, time, p.timezone);
  };

  const tasks: DemoTask[] = [
    {
      id: "t1", type: "linen_delivery", status: "validated", priority: "normal", propertyId: "p1",
      assigneeId: "a4", windowStart: at("p1", "08:30"), windowEnd: at("p1", "10:30"),
      scheduledStart: at("p1", "09:00"), durationMin: 30, guests: null, sameDayArrival: false,
    },
    {
      id: "t2", type: "turnover", status: "assigned", priority: "high", propertyId: "p1",
      assigneeId: "a1", windowStart: at("p1", "11:00"), windowEnd: at("p1", "15:00"),
      scheduledStart: at("p1", "11:15"), durationMin: 150, guests: 4, sameDayArrival: true,
    },
    {
      id: "t3", type: "turnover", status: "in_progress", priority: "high", propertyId: "p2",
      assigneeId: "a2", windowStart: at("p2", "10:00"), windowEnd: at("p2", "16:00"),
      scheduledStart: at("p2", "10:30"), durationMin: 90, guests: 2, sameDayArrival: true,
    },
    {
      id: "t4", type: "turnover", status: "unassigned", priority: "normal", propertyId: "p3",
      assigneeId: null, windowStart: at("p3", "11:00"), windowEnd: at("p3", "16:00", 1),
      scheduledStart: null, durationMin: 120, guests: 3, sameDayArrival: false,
    },
    {
      id: "t5", type: "check_in", status: "assigned", priority: "normal", propertyId: "p4",
      assigneeId: "a1", windowStart: at("p4", "15:30"), windowEnd: at("p4", "18:00"),
      scheduledStart: at("p4", "16:00"), durationMin: 30, guests: 5, sameDayArrival: false,
    },
    {
      id: "t6", type: "turnover", status: "unassigned", priority: "urgent", propertyId: "p5",
      assigneeId: null, windowStart: at("p5", "11:00"), windowEnd: at("p5", "13:30"),
      scheduledStart: null, durationMin: 180, guests: 6, sameDayArrival: true,
    },
    {
      id: "t7", type: "turnover", status: "done", priority: "high", propertyId: "p6",
      assigneeId: "a3", windowStart: at("p6", "10:00"), windowEnd: at("p6", "15:00"),
      scheduledStart: at("p6", "10:00"), durationMin: 120, guests: 2, sameDayArrival: true,
    },
    {
      id: "t8", type: "check_out", status: "assigned", priority: "normal", propertyId: "p2",
      assigneeId: "a2", windowStart: at("p2", "09:45"), windowEnd: at("p2", "10:30"),
      scheduledStart: at("p2", "09:45"), durationMin: 20, guests: 2, sameDayArrival: false,
    },
  ];

  const upcoming: DemoTask[] = [1, 2, 3, 5].map((offset, i) => ({
    id: `u${i}`,
    type: i === 2 ? "check_in" : "turnover",
    status: "assigned",
    priority: i === 0 ? "high" : "normal",
    propertyId: demoProperties[(i + 1) % demoProperties.length].id,
    assigneeId: "a1",
    windowStart: at(demoProperties[(i + 1) % demoProperties.length].id, i === 2 ? "15:00" : "11:00", offset),
    windowEnd: at(demoProperties[(i + 1) % demoProperties.length].id, i === 2 ? "17:00" : "16:00", offset),
    scheduledStart: null,
    durationMin: 120,
    guests: 2 + i,
    sameDayArrival: i === 0,
  }));

  return {
    tasks,
    upcoming,
    arrivals: 5,
    departures: 4,
    openIncidents: 1,
    urgentIncidents: 1,
  };
}
