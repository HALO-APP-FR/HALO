/**
 * Fiche séjour : « maintenant » — ce qui demande une action, dans l'ordre d'urgence, avec un lien vers la section.
 * Règle pure (testée) : rien n'est inventé, chaque ligne correspond à un élément réel de la fiche.
 */
export type StayNowKey = "conflict" | "arrival_risk" | "guest_messages" | "guest_requests" | "vip_request" | "prep_review" | "blocking_actions" | "unassigned_missions";
export interface StayNowItem {
  key: StayNowKey;
  count: number;
  anchor: string;
}

export interface StayNowInput {
  conflicts: number;
  /** Missions liées incompatibles ou à risque avec l'heure d'arrivée */
  arrivalRisks: number;
  unreadGuestMessages: number;
  /** Demandes de prestation nouvelles ou non lues par l'équipe */
  servicesToAnswer: number;
  vipPending: boolean;
  prepNeedsReview: boolean;
  blockingActions: number;
  unassignedMissions: number;
}

export function stayNow(i: StayNowInput): StayNowItem[] {
  const all: StayNowItem[] = [
    { key: "conflict", count: i.conflicts, anchor: "stay-schedule-conflict" },
    { key: "arrival_risk", count: i.arrivalRisks, anchor: "stay-prep-checks" },
    { key: "guest_messages", count: i.unreadGuestMessages, anchor: "stay-messages" },
    { key: "guest_requests", count: i.servicesToAnswer, anchor: "stay-services" },
    { key: "vip_request", count: i.vipPending ? 1 : 0, anchor: "stay-vip" },
    { key: "prep_review", count: i.prepNeedsReview ? 1 : 0, anchor: "stay-prep" },
    { key: "blocking_actions", count: i.blockingActions, anchor: "stay-prep" },
    { key: "unassigned_missions", count: i.unassignedMissions, anchor: "stay-missions" },
  ];
  return all.filter((x) => x.count > 0);
}
