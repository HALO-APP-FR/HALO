/**
 * Préparation assistée de la configuration initiale.
 * Ce sont des RÈGLES transparentes appliquées aux réponses de l'onboarding (aucun modèle externe n'est appelé) :
 * chaque proposition porte la raison qui l'a déclenchée, et rien n'est enregistré sans confirmation.
 * Aucune information légale n'est produite ici.
 */

export type ActivityType =
  | "concierge"
  | "short_term_rental"
  | "residence"
  | "aparthotel"
  | "independent_hotel";
export type CleaningModel = "internal" | "providers" | "both";
export type LinenModel = "internal" | "laundry" | "both" | "none";
export type ValidationPolicy = "all" | "turnover" | "none";

export const ACTIVITY_TYPES: ActivityType[] = [
  "concierge",
  "short_term_rental",
  "residence",
  "aparthotel",
  "independent_hotel",
];
export const SERVICE_KINDS = [
  "private_chef",
  "restaurant",
  "driver",
  "airport_transfer",
  "grocery",
  "spa",
  "babysitter",
  "experience",
  "flowers",
  "other",
] as const;
export const TASK_TYPES = [
  "turnover",
  "check_in",
  "check_out",
  "linen_delivery",
  "linen_pickup",
  "inspection",
] as const;
export const ALERTS = [
  "unassigned_missions",
  "pending_services",
  "unread_messages",
  "failed_emails",
  "upcoming_stays",
] as const;
export type Alert = (typeof ALERTS)[number];
export type TaskType = (typeof TASK_TYPES)[number];

export const isHotelLike = (a: ActivityType | null | undefined) =>
  a === "independent_hotel" || a === "aparthotel" || a === "residence";

/** Problèmes fréquents proposés, selon le type d'activité (pas de questions d'hôtel à une conciergerie d'appartements). */
export function issueOptions(a: ActivityType | null | undefined): string[] {
  const common = [
    "late_cleaning",
    "missing_linen",
    "damage",
    "guest_complaints",
    "staff_no_show",
    "late_checkout",
  ];
  return isHotelLike(a)
    ? [...common, "room_not_ready", "housekeeping_control"]
    : [...common, "key_handover", "access_problems"];
}

/** Canaux de réservation : demandés seulement là où un import de calendrier a un sens. */
export const channelOptions = (a: ActivityType | null | undefined) =>
  a === "independent_hotel" || a === "residence"
    ? []
    : ["airbnb", "booking", "vrbo", "direct"];

export interface Answers {
  activity_type?: ActivityType | null;
  unit_count?: number | null;
  cleaning_model?: CleaningModel | null;
  linen_model?: LinenModel | null;
  validation_policy?: ValidationPolicy | null;
  welcome_service?: boolean | null; // appartements : accueil / remise des clés
  room_inspection?: boolean | null; // hôtellerie : contrôle des chambres
  services_offered?: string[];
  frequent_issues?: string[];
}

export interface ChecklistRoom {
  room: string;
  items: { label: string; photo_required: boolean }[];
}

export type Proposal =
  | { id: "task_types"; value: TaskType[]; reasons: string[] }
  | { id: "checklist"; value: ChecklistRoom[]; reasons: string[] }
  | { id: "validation"; value: TaskType[]; reasons: string[] }
  | { id: "alerts"; value: Alert[]; reasons: string[] }
  | { id: "linen"; value: number; reasons: string[] };

/** Libellés des pièces et points de contrôle : traduits par l'appelant (clés), pour rester dans la langue de l'utilisateur. */
export type Labeler = (key: string) => string;

export function proposeConfiguration(
  a: Answers,
  label: Labeler,
): { proposals: Proposal[]; nextStep: "property" | "team" } {
  const hotel = isHotelLike(a.activity_type);
  const issues = new Set(a.frequent_issues ?? []);
  const proposals: Proposal[] = [];

  // 1. Catégories de missions
  const types: TaskType[] = ["turnover"];
  const tReasons = ["turnover_always"];
  if (!hotel && a.welcome_service) {
    types.push("check_in", "check_out");
    tReasons.push("welcome_service");
  }
  if (issues.has("key_handover") && !types.includes("check_in")) {
    types.push("check_in");
    tReasons.push("issue_key_handover");
  }
  if (a.linen_model === "laundry" || a.linen_model === "both") {
    types.push("linen_delivery", "linen_pickup");
    tReasons.push("linen_missions");
  }
  if ((hotel && a.room_inspection) || issues.has("housekeeping_control")) {
    types.push("inspection");
    tReasons.push(hotel ? "room_inspection" : "issue_control");
  }
  proposals.push({
    id: "task_types",
    value: Array.from(new Set(types)),
    reasons: tReasons,
  });

  // 2. Checklist type
  const photo = (k: string) => ({
    label: label(`check.${k}`),
    photo_required: true,
  });
  const plain = (k: string) => ({
    label: label(`check.${k}`),
    photo_required: false,
  });
  const checklist: ChecklistRoom[] = hotel
    ? [
        {
          room: label("room.bedroom"),
          items: [
            photo("bed_made"),
            plain("dust"),
            plain("minibar"),
            plain("amenities"),
          ],
        },
        {
          room: label("room.bathroom"),
          items: [
            photo("bathroom_clean"),
            plain("towels"),
            plain("toiletries"),
          ],
        },
      ]
    : [
        {
          room: label("room.living"),
          items: [photo("living_tidy"), plain("dust"), plain("windows")],
        },
        {
          room: label("room.kitchen"),
          items: [
            photo("kitchen_clean"),
            plain("dishes"),
            plain("fridge_empty"),
            plain("consumables"),
          ],
        },
        {
          room: label("room.bedroom"),
          items: [photo("bed_made"), plain("linen_changed")],
        },
        {
          room: label("room.bathroom"),
          items: [
            photo("bathroom_clean"),
            plain("towels"),
            plain("toiletries"),
          ],
        },
      ];
  const cReasons = [hotel ? "checklist_hotel" : "checklist_apartment"];
  if (issues.has("damage")) {
    checklist.push({
      room: label("room.general"),
      items: [photo("damage_check")],
    });
    cReasons.push("issue_damage");
  }
  if (issues.has("missing_linen")) {
    checklist
      .find((r) => r.room === label("room.bedroom"))
      ?.items.push(plain("linen_count"));
    cReasons.push("issue_missing_linen");
  }
  proposals.push({ id: "checklist", value: checklist, reasons: cReasons });

  // 3. Règles de validation (quelles missions passent par un contrôle avant d'être closes)
  const policy =
    a.validation_policy ??
    (a.cleaning_model === "providers" || a.cleaning_model === "both"
      ? "turnover"
      : "none");
  const validation: TaskType[] =
    policy === "all"
      ? Array.from(new Set(types))
      : policy === "turnover"
        ? ["turnover"]
        : [];
  const vReasons = [
    a.validation_policy
      ? `validation_${policy}`
      : policy === "turnover"
        ? "validation_providers"
        : "validation_none",
  ];
  if (
    validation.length &&
    types.includes("inspection") &&
    !validation.includes("inspection")
  )
    validation.push("inspection");
  proposals.push({ id: "validation", value: validation, reasons: vReasons });

  // 4. Alertes opérationnelles affichées à l'accueil
  const alerts: Alert[] = [
    "pending_services",
    "unread_messages",
    "failed_emails",
  ];
  const aReasons = ["alerts_guest"];
  if (
    issues.has("late_cleaning") ||
    issues.has("staff_no_show") ||
    issues.has("room_not_ready")
  ) {
    alerts.unshift("unassigned_missions");
    aReasons.push("issue_late_cleaning");
  } else alerts.unshift("unassigned_missions");
  if ((a.unit_count ?? 0) >= 5 || issues.has("late_checkout")) {
    alerts.push("upcoming_stays");
    aReasons.push("alerts_volume");
  }
  proposals.push({ id: "alerts", value: alerts, reasons: aReasons });

  // 5. Premières règles de suivi du linge (délai de rotation)
  if (a.linen_model && a.linen_model !== "none") {
    const days = a.linen_model === "internal" ? 1 : 3;
    proposals.push({
      id: "linen",
      value: days,
      reasons: [`linen_${a.linen_model}`],
    });
  }

  return { proposals, nextStep: "property" };
}
