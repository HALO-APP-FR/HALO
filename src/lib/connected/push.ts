import "server-only";
import webpush from "web-push";
import { getTranslations } from "next-intl/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { locales, type Locale } from "@/i18n/routing";

/**
 * Notifications push (Web Push, norme ouverte, sans abonnement payant) — migration 28.
 *
 * Inactives tant que les trois variables d'environnement du serveur ne sont pas définies :
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (secrète, jamais dans le dépôt ni côté navigateur), VAPID_SUBJECT (mailto:…).
 * Résultat enregistré = résultat RÉEL du service de notification du téléphone (Apple, Google, Mozilla) :
 * « accepted » signifie « accepté pour livraison », jamais « reçu » ni « lu ».
 */
export type PushCategory =
  | "mission" | "correction" | "overrun_reminder" | "message" | "urgent_message"
  | "incident" | "guest_request" | "to_validate" | "overrun" | "laundry"
  | "guest_update";
/** Miroir de public.push_category (migration 33) — vérifié par les tests. */
export const PUSH_CATEGORY: Record<string, PushCategory> = {
  agent_task_assigned: "mission",
  agent_task_changed: "mission",
  agent_correction_requested: "correction",
  agent_task_overrun: "overrun_reminder",
  chat_message: "message",
  chat_urgent: "urgent_message",
  team_agent_blocker: "incident",
  team_guest_problem: "incident",
  team_service_requested: "guest_request",
  team_guest_message: "guest_request",
  team_vip_requested: "guest_request",
  team_booking_requested: "guest_request",
  team_guest_reply: "guest_request",
  team_task_to_validate: "to_validate",
  team_task_overrun: "overrun",
  team_laundry_gap: "laundry",
  team_laundry_update: "laundry",
  service_received: "guest_update",
  service_updated: "guest_update",
  service_confirmed: "guest_update",
  service_declined: "guest_update",
  service_info_requested: "guest_update",
  service_cancelled: "guest_update",
  service_done: "guest_update",
  problem_taken: "guest_update",
  problem_resolved: "guest_update",
  stay_message: "guest_update",
  vip_update: "guest_update",
  booking_update: "guest_update",
};
/** Urgences : toujours envoyées en push dès qu'un appareil est inscrit (préférence non désactivable). */
export const ALWAYS_PUSH: ReadonlySet<PushCategory> = new Set(["urgent_message", "incident"]);
/** Réglages (événements des préférences) qui ont un push ; « team_laundry » regroupe écart et linge en route. */
export const PUSH_EVENTS = new Set([
  "team_service_requested", "team_guest_reply", "team_guest_problem", "team_guest_message", "team_agent_blocker", "team_vip_requested",
  "team_booking_requested", "team_task_to_validate", "team_task_overrun", "team_laundry", "chat_message", "agent_task_assigned",
  "agent_task_changed", "agent_correction_requested", "agent_task_overrun",
]);
/** Réglages dont le push ne peut pas être coupé (urgences) */
export const PUSH_LOCKED = new Set(["team_agent_blocker", "team_guest_problem"]);

export function pushConfig() {
  const publicKey = process.env.VAPID_PUBLIC_KEY ?? "";
  const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
  const subject = process.env.VAPID_SUBJECT ?? "";
  const ok = /^[A-Za-z0-9_-]{80,100}$/.test(publicKey) && privateKey.length >= 40 && /^(mailto:|https:\/\/)/.test(subject);
  return ok ? { publicKey, privateKey, subject } : null;
}
export const pushConfigured = () => pushConfig() !== null;
/** Clé publique (non secrète) transmise au navigateur pour l'inscription */
export const pushPublicKey = () => pushConfig()?.publicKey ?? null;

type Sub = { id: string; endpoint: string; p256dh: string; auth: string; guest?: boolean };
export type PushResult = { subscriptionId: string; status: "accepted" | "failed" | "expired" | "not_configured"; error: string | null };

/** Envoi à une liste d'appareils ; un appareil expiré (404/410) est désactivé. */
export async function sendPush(admin: SupabaseClient, subs: Sub[], message: { title: string; body: string; url: string; tag: string; urgent: boolean }): Promise<PushResult[]> {
  const cfg = pushConfig();
  if (!cfg) return subs.map((s) => ({ subscriptionId: s.id, status: "not_configured", error: "no_vapid_keys" }));
  const out: PushResult[] = [];
  for (const s of subs) {
    try {
      const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify(message), {
        vapidDetails: cfg,
        TTL: message.urgent ? 6 * 3600 : 24 * 3600,
        urgency: message.urgent ? "high" : "normal",
        timeout: 10_000,
      });
      out.push({ subscriptionId: s.id, status: r.statusCode >= 200 && r.statusCode < 300 ? "accepted" : "failed", error: r.statusCode >= 300 ? `http_${r.statusCode}` : null });
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      out.push({ subscriptionId: s.id, status: code === 404 || code === 410 ? "expired" : "failed", error: code ? `http_${code}` : String(e instanceof Error ? e.message : e).slice(0, 200) });
    }
  }
  const now = new Date().toISOString();
  for (const r of out) {
    // Appareil d'un voyageur (séjour) ou d'un membre (compte) : chacun sa table
    const table = subs.find((x) => x.id === r.subscriptionId)?.guest ? "guest_push_subscriptions" : "push_subscriptions";
    if (r.status === "accepted") await admin.from(table).update({ last_success_at: now, last_error: null, last_error_at: null }).eq("id", r.subscriptionId);
    else if (r.status === "expired") await admin.from(table).update({ disabled_at: now, last_error: r.error, last_error_at: now }).eq("id", r.subscriptionId);
    else if (r.status === "failed") await admin.from(table).update({ last_error: r.error, last_error_at: now }).eq("id", r.subscriptionId);
  }
  return out;
}

/** Texte neutre (écran verrouillé) : catégorie + logement ; jamais le nom du voyageur ni le contenu d'un message. */
export async function pushMessage(category: PushCategory | "test", localeRaw: string, payload: Record<string, unknown>, base: string) {
  const locale = (locales as readonly string[]).includes(localeRaw) ? (localeRaw as Locale) : "en";
  const t = await getTranslations({ locale, namespace: "push" });
  const property = typeof payload.property === "string" ? payload.property : "";
  const path = typeof payload.path === "string" && payload.path.startsWith("/") && !payload.path.startsWith("//") ? payload.path : "";
  return {
    title: t(`${category}.title`),
    body: property ? t(`${category}.bodyProperty`, { property }) : t(`${category}.body`),
    // Voyageur : pas d'adresse dans le message (le lien de son espace n'est pas conservé en clair) ; le téléphone
    // ouvre la page d'où il s'est inscrit (portée du service worker).
    url: category === "guest_update" ? "" : path ? `${base}/${locale}${path}` : `${base}/${locale}/app`,
    tag: category === "guest_update" ? `guest-${String(payload.kind ?? "update")}` : category,
    urgent: ALWAYS_PUSH.has(category as PushCategory),
  };
}

/**
 * Notification préparée (outbox) : envoie le push si la personne l'a choisi et a un appareil inscrit
 * (une seule fois par notification, même en cas de relance de l'e-mail). Renvoie si l'e-mail reste voulu et,
 * sinon, pourquoi (préférence de la personne, ou voyageur sans adresse e-mail).
 * Migration 28 absente : ne fait rien et laisse l'e-mail suivre son cours.
 */
export async function pushForOutbox(admin: SupabaseClient, row: { id: string; organization_id: string; template: string; locale: string; payload: Record<string, unknown>; reservation_id?: string | null }, base: string): Promise<{ email: boolean; reason?: string }> {
  if (!PUSH_CATEGORY[row.template]) return { email: true };
  const { data, error } = await admin.rpc("outbox_channels", { outbox: row.id });
  if (error || !data) {
    if (error && error.code !== "PGRST202") console.error("push outbox_channels", error.code, error.message);
    return { email: true };
  }
  const ch = data as { user_id?: string; reservation_id?: string; category?: PushCategory; email: boolean; email_reason?: string; push_done?: boolean; push: Sub[] };
  if ((ch.user_id || ch.reservation_id) && ch.category && ch.push.length && !ch.push_done) {
    const results = await sendPush(admin, ch.push, await pushMessage(ch.category, row.locale, row.payload, base));
    const { error: le } = await admin.from("push_deliveries").insert(
      results.map((r) => ({
        organization_id: row.organization_id,
        outbox_id: row.id,
        user_id: ch.user_id ?? null,
        reservation_id: ch.user_id ? null : (ch.reservation_id ?? null),
        subscription_id: ch.user_id ? r.subscriptionId : null,
        category: ch.category,
        status: r.status,
        error: r.error,
      })),
    );
    if (le) console.error("push journal", le.code, le.message);
  }
  return { email: ch.email !== false, reason: ch.email_reason };
}
