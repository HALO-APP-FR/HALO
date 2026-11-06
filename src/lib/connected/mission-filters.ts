/** Valeurs des filtres de la liste des missions (partagées serveur / navigateur). */
export const PERIODS = ["today", "week", "upcoming", "past"] as const;
export const STATUS_FILTERS = ["todo", "unassigned", "assigned", "in_progress", "done", "to_redo", "validated", "all"] as const;
export const TYPES = ["turnover", "check_in", "check_out", "linen_delivery", "linen_pickup", "inspection", "maintenance", "other"] as const;
