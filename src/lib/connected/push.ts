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
export const PUSH_CATEGORY: Record<string, PushCategory> = {
  agent_task_assigned: "mission",
  agent_task_changed: "mission",
  agent_correction_requested: "correction",
  chat_urgent: "urgent_message",
  team_agent_blocker: "incident",
  team_guest_problem: "incident",
  team_service_requested: "guest_request",
  team_guest_message: "guest_request",
  team_vip_requested: "guest_request",
  team_booking_requested: "guest_request",
};
export type PushCategory = "mission" | "correction" | "urgent_message" | "incident" | "guest_request";
/** Événements des préférences pour lesquels un push existe (« chat_message » : messages urgents seulement) */
export const PUSH_EVENTS = new Set([...Object.keys(PUSH_CATEGORY).filter((k) => k !== "chat_urgent"), "chat_message"]);

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

type Sub = { id: string; endpoint: string; p256dh: string; auth: string };
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
    if (r.status === "accepted") await admin.from("push_subscriptions").update({ last_success_at: now, last_error: null, last_error_at: null }).eq("id", r.subscriptionId);
    else if (r.status === "expired") await admin.from("push_subscriptions").update({ disabled_at: now, last_error: r.error, last_error_at: now }).eq("id", r.subscriptionId);
    else if (r.status === "failed") await admin.from("push_subscriptions").update({ last_error: r.error, last_error_at: now }).eq("id", r.subscriptionId);
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
    url: path ? `${base}/${locale}${path}` : `${base}/${locale}/app`,
    tag: category,
    urgent: category === "urgent_message" || category === "incident",
  };
}

/**
 * Notification préparée (outbox) : envoie le push si la personne l'a choisi et a un appareil inscrit
 * (une seule fois par notification, même en cas de relance de l'e-mail). Renvoie si l'e-mail reste voulu.
 * Migration 28 absente : ne fait rien et laisse l'e-mail suivre son cours.
 */
export async function pushForOutbox(admin: SupabaseClient, row: { id: string; organization_id: string; template: string; locale: string; payload: Record<string, unknown> }, base: string): Promise<{ email: boolean }> {
  if (!PUSH_CATEGORY[row.template]) return { email: true };
  const { data, error } = await admin.rpc("outbox_channels", { outbox: row.id });
  if (error || !data) {
    if (error && error.code !== "PGRST202") console.error("push outbox_channels", error.code, error.message);
    return { email: true };
  }
  const ch = data as { user_id?: string; category?: PushCategory; email: boolean; push_done?: boolean; push: Sub[] };
  if (ch.user_id && ch.category && ch.push.length && !ch.push_done) {
    const results = await sendPush(admin, ch.push, await pushMessage(ch.category, row.locale, row.payload, base));
    const { error: le } = await admin.from("push_deliveries").insert(
      results.map((r) => ({ organization_id: row.organization_id, outbox_id: row.id, user_id: ch.user_id, subscription_id: r.subscriptionId, category: ch.category, status: r.status, error: r.error })),
    );
    if (le) console.error("push journal", le.code, le.message);
  }
  return { email: ch.email !== false };
}
