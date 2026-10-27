/**
 * Boîte de notifications DANS L'APPLICATION.
 *
 * Les notifications sont calculées à partir de l'état réel des données
 * (rien n'est « envoyé » : aucun e-mail, aucun push, aucun SMS).
 * Chaque notification a une clé stable : rejouer la même opération ne crée
 * pas de doublon, et l'état « lu » survit aux recalculs.
 */
import type { Alert, ServiceRequest, Task } from "@/lib/domain/types";
import { infeasibility } from "./conflicts";

export type NotificationKind = "service_requested" | "task_to_validate" | "task_correction" | "task_blocked" | "task_unassigned" | "alert_urgent" | "linen_shortage";
export const NOTIFICATION_KINDS: NotificationKind[] = ["alert_urgent", "service_requested", "task_to_validate", "task_correction", "task_blocked", "task_unassigned", "linen_shortage"];
/** Alertes critiques : toujours affichées, impossibles à désactiver. */
export const CRITICAL_KINDS: NotificationKind[] = ["alert_urgent"];
/** Destinataires par défaut : qui est responsable de l'événement. */
export const KIND_AUDIENCE: Record<NotificationKind, "manager" | "agent"> = {
  alert_urgent: "manager",
  service_requested: "manager",
  task_to_validate: "manager",
  task_correction: "agent",
  task_blocked: "manager",
  task_unassigned: "manager",
  linen_shortage: "manager",
};

export type NotificationTarget = { type: "task"; id: string } | { type: "service"; id: string } | { type: "href"; href: string };

export interface InboxItem {
  key: string;
  kind: NotificationKind;
  critical: boolean;
  at: string;
  propertyId?: string;
  /** Paramètres du texte (nom du logement, nombre…). */
  params: Record<string, string | number>;
  target: NotificationTarget;
}

export interface InboxInput {
  tasks: Task[];
  services: ServiceRequest[];
  alerts: Alert[];
  /** Articles de linge en rupture prévue (calculés par le moteur de linge). */
  linenShortages?: { linenTypeId: string; day: string; name?: string }[];
  now: Date;
  /** Types désactivés par la personne (les critiques restent affichés). */
  muted?: NotificationKind[];
  audience: "manager" | "agent";
  /** Pour l'espace Agent : seulement ses missions. */
  memberId?: string;
}

const DAY = 86_400_000;

export function buildInbox(input: InboxInput): InboxItem[] {
  const { tasks, services, alerts, now, audience, memberId } = input;
  const muted = new Set((input.muted ?? []).filter((k) => !CRITICAL_KINDS.includes(k)));
  const items: InboxItem[] = [];
  const push = (item: Omit<InboxItem, "critical">) => {
    if (KIND_AUDIENCE[item.kind] !== audience || muted.has(item.kind)) return;
    items.push({ ...item, critical: CRITICAL_KINDS.includes(item.kind) });
  };

  if (audience === "manager") {
    for (const a of alerts) {
      if (a.urgent && a.status !== "resolved") push({ key: `alert:${a.id}:urgent`, kind: "alert_urgent", at: a.createdAt, propertyId: a.propertyId, params: {}, target: { type: "href", href: "/alerts" } });
    }
    for (const s of services) {
      // Une demande de prestation n'est jamais un incident, même urgente pour le voyageur
      if (s.status === "requested") push({ key: `svc:${s.id}:requested`, kind: "service_requested", at: s.createdAt, propertyId: s.propertyId, params: { kind: s.kind }, target: { type: "service", id: s.id } });
    }
    for (const x of tasks) {
      if (x.status === "done") {
        push({ key: `task:${x.id}:done:${x.completedAt ?? ""}`, kind: "task_to_validate", at: x.completedAt ?? x.windowEnd, propertyId: x.propertyId, params: { type: x.type }, target: { type: "task", id: x.id } });
      }
      const issue = infeasibility(x, now);
      if (issue) {
        push({ key: `task:${x.id}:blocked:${issue}`, kind: "task_blocked", at: x.windowStart, propertyId: x.propertyId, params: { type: x.type, reason: issue }, target: { type: "task", id: x.id } });
      } else if (x.status === "unassigned" && new Date(x.windowEnd).getTime() > now.getTime() && new Date(x.windowStart).getTime() < now.getTime() + DAY) {
        push({ key: `task:${x.id}:unassigned`, kind: "task_unassigned", at: x.windowStart, propertyId: x.propertyId, params: { type: x.type }, target: { type: "task", id: x.id } });
      }
    }
    for (const l of input.linenShortages ?? []) {
      push({ key: `linen:${l.linenTypeId}:${l.day}`, kind: "linen_shortage", at: `${l.day}T00:00:00.000Z`, params: { day: l.day, item: l.name ?? "" }, target: { type: "href", href: "/linen" } });
    }
  } else {
    for (const x of tasks) {
      if (x.assigneeId !== memberId || x.status !== "to_redo") continue;
      const ev = [...(x.events ?? [])].reverse().find((e) => e.kind === "correction_requested");
      push({ key: `task:${x.id}:redo:${ev?.at ?? ""}`, kind: "task_correction", at: ev?.at ?? x.windowStart, propertyId: x.propertyId, params: { reason: x.correctionReason ?? "" }, target: { type: "task", id: x.id } });
    }
  }
  // Critiques d'abord, puis les plus récentes
  return items.sort((a, b) => Number(b.critical) - Number(a.critical) || b.at.localeCompare(a.at));
}

export const unreadCount = (items: InboxItem[], read: Set<string>) => items.filter((i) => !read.has(i.key)).length;
