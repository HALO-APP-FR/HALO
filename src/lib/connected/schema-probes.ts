import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Migrations nécessaires à CETTE version de l'application, chacune vérifiée par un objet qu'elle seule crée
 * (table, colonne ou fonction). Ajouter une ligne à chaque nouvelle migration (test unitaire : liste complète).
 *  - table / colonne : lecture GET de 0 ligne avec la clé serveur (absente → PGRST205 / 42P01 / 42703). Jamais une
 *    requête HEAD : sans corps de réponse, une table absente y passait pour présente (constaté le 12/11) ;
 *  - fonction : appel anonyme avec les bons paramètres ; une fonction réservée aux comptes répond « interdit »
 *    (42501) SANS s'exécuter si elle existe, « introuvable » (PGRST202) sinon.
 * Toute autre réponse (réseau, délai, clé absente) → « non vérifié », jamais « à jour ».
 */
export type Probe = { version: string; name: string } & ({ table: string; column?: string } | { rpc: string; args: Record<string, unknown> });

const Z = "00000000-0000-0000-0000-000000000000";
export const SCHEMA_PROBES: Probe[] = [
  { version: "20261027000001", name: "lot1_socle", table: "profiles" },
  { version: "20261028000001", name: "lot1_cycle_mission", table: "task_events" },
  { version: "20261029000001", name: "liens_invites", table: "guest_guides" },
  { version: "20261030000001", name: "onboarding_voyageur_notifications", table: "service_requests" },
  // 20261031000001 (suppression d'organisation) : remplace seulement une fonction interne, reprise par 20261115000001
  { version: "20261101000001", name: "incidents", table: "incidents" },
  { version: "20261102000001", name: "maintenance_linge", table: "incidents", column: "follow_up_task_id" },
  { version: "20261103000001", name: "preuves_codes_notifications", table: "files", column: "superseded_at" },
  { version: "20261104000001", name: "validation_creneaux_absences", table: "absences" },
  { version: "20261105000001", name: "messagerie_lieux_preferences", table: "notification_prefs" },
  { version: "20261106000001", name: "preferences_recommandations_absences", table: "properties", column: "auto_places" },
  { version: "20261107000001", name: "preparation_vip_fiabilisation", table: "stay_preparations" },
  { version: "20261108000001", name: "corrections_import_sources", table: "import_jobs" },
  { version: "20261109000001", name: "reservation_directe_satisfaction", table: "booking_links" },
  { version: "20261110000001", name: "scenario_operationnel_satisfaction_service", table: "reviews", column: "service_overall" },
  { version: "20261111000001", name: "arrivee_anticipee_absences_confidentialite", table: "service_requests", column: "timing_previous_at" },
  { version: "20261112000001", name: "horaires_coherents_lieux_proteges", rpc: "timing_inconsistencies", args: { org: Z } },
  { version: "20261113000001", name: "horaires_successifs_historique", table: "service_requests", column: "superseded_by" },
  { version: "20261114000001", name: "regles_missions_linge_correction", table: "task_type_rules" },
  { version: "20261115000001", name: "origine_plages_conflits_arrivee", rpc: "apply_task_sync", args: { org: Z, task: Z, patch: {} } },
  { version: "20261116000001", name: "depassement_fin_incident_ouvert", table: "organizations", column: "overrun_alert_min" },
  { version: "20261117000001", name: "alentours_types_favoris", table: "stay_place_favorites" },
  { version: "20261118000001", name: "regularisation_annulation_en_cours", table: "tasks", column: "regularized_at" },
  { version: "20261119000001", name: "retour_calcul_automatique", rpc: "restore_auto_window", args: { org: Z, task: Z, ws: "2000-01-01T00:00:00Z", we: "2000-01-01T01:00:00Z", dur: 30 } },
  { version: "20261120000001", name: "alentours_avant_arrivee", table: "property_places", column: "scope" },
  { version: "20261121000001", name: "linge_operationnel", table: "linen_items" },
  { version: "20261122000001", name: "recommandations_avant_arrivee", table: "property_places", column: "guest_visibility" },
  { version: "20261123000001", name: "notifications_push", table: "push_subscriptions" },
  { version: "20261124000001", name: "alentours_liste_quartier", rpc: "zone_places_state", args: { found_at: null, tried_at: null } },
  { version: "20261125000001", name: "push_comptes_de_test", rpc: "push_wanted_for_recipient", args: { org: Z, rcpt: "x@halo.invalid", tpl: "agent_task_assigned" } },
  { version: "20261126000001", name: "linge_inventaire_concurrent", rpc: "linen_count", args: { org: Z, item: Z, loc: "clean", counted: 0, note: null, expected: 0 } },
  { version: "20261127000001", name: "blanchisseur_externe", table: "laundry_orders" },
  { version: "20261128000001", name: "notifications_completes", rpc: "laundry_gap_resolve", args: { org: Z, oid: Z, item: Z, qty: 1, outcome: "lost", p_note: null } },
  { version: "20261129000001", name: "tache_planifiee", rpc: "cron_token_ok", args: { token: "x" } },
];

export type ProbeState = "ok" | "missing" | "unverified";

export async function probeSchema(admin: SupabaseClient | null, anon: SupabaseClient, timeout: <T>(p: Promise<T>) => Promise<T>) {
  return Promise.all(
    SCHEMA_PROBES.map(async (p): Promise<{ version: string; name: string; state: ProbeState }> => {
      try {
        if ("rpc" in p) {
          const { error } = await timeout(Promise.resolve(anon.rpc(p.rpc, p.args)));
          const state: ProbeState = error?.code === "PGRST202" ? "missing" : error?.code === "42501" ? "ok" : "unverified";
          return { version: p.version, name: p.name, state };
        }
        if (!admin) return { version: p.version, name: p.name, state: "unverified" };
        const { error } = await timeout(Promise.resolve(admin.from(p.table).select(p.column ?? "*").limit(0)));
        const state: ProbeState = !error ? "ok" : ["PGRST205", "42P01", "42703", "PGRST204"].includes(error.code ?? "") ? "missing" : "unverified";
        return { version: p.version, name: p.name, state };
      } catch {
        return { version: p.version, name: p.name, state: "unverified" };
      }
    }),
  );
}
