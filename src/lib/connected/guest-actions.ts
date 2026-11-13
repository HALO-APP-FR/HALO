"use server";

/**
 * Actions du voyageur : SANS compte, uniquement par son lien de séjour.
 * Le client utilisé est anonyme : la base n'autorise que les fonctions voyageur,
 * et chacune revérifie le lien (période, révocation, séjour) à chaque appel.
 */
import { revalidatePath } from "next/cache";
import { supabaseAnon } from "@/lib/supabase/server";
import { processOutbox } from "./outbox";

export type GuestResult = { ok: true } | { ok: false; error: "unavailable" | "empty" | "invalid" | "server" };
type Rpc = { status: string; email_queued?: boolean };

async function call(fn: string, args: Record<string, unknown>, token: string): Promise<GuestResult> {
  const { data, error } = await supabaseAnon().rpc(fn, args);
  if (error) return { ok: false, error: error.code === "23514" || error.code === "22P02" ? "invalid" : "server" };
  const res = data as Rpc;
  if (res.status !== "ok") return { ok: false, error: res.status === "empty" ? "empty" : res.status === "invalid" ? "invalid" : "unavailable" };
  // Voyageur (accusé de réception) et responsables (nouvelle demande, problème, message) : envois réels, état tracé
  await processOutbox();
  revalidatePath(`/[locale]/s/${token}`, "page");
  return { ok: true };
}

export async function guestRequestService(token: string, input: { kind: string; startAt: string; people: number; details: string }) {
  return call("guest_request_service", { token, s_kind: input.kind, s_start_at: input.startAt, s_people: input.people, s_details: input.details }, token);
}

export async function guestReplyService(token: string, serviceId: string, message: string) {
  return call("guest_reply_service", { token, service: serviceId, message }, token);
}

export async function guestSendMessage(token: string, message: string) {
  return call("guest_send_message", { token, message }, token);
}

export async function guestReportProblem(token: string, input: { category: string; description: string; urgent: boolean }) {
  return call("guest_report_problem", { token, i_category: input.category, i_description: input.description, i_urgent: input.urgent }, token);
}

/** Questionnaire « Préparons votre séjour » : brouillon ou envoi ; « locked » après l'arrivée. */
export async function guestSavePreparation(token: string, answers: Record<string, unknown>, submit: boolean): Promise<GuestResult | { ok: false; error: "locked" }> {
  const { data, error } = await supabaseAnon().rpc("guest_save_preparation", { token, answers, submit });
  if (error) return { ok: false, error: "server" };
  const res = data as Rpc;
  if (res.status === "locked") return { ok: false, error: "locked" };
  if (res.status !== "ok") return { ok: false, error: "unavailable" };
  await processOutbox();
  revalidatePath(`/[locale]/s/${token}`, "page");
  return { ok: true };
}

export async function guestDeletePreparation(token: string) {
  return call("guest_delete_preparation", { token }, token);
}

/** Demande d'étude d'un accueil VIP : jamais une confirmation, seulement « demande envoyée ». */
export async function guestRequestVip(token: string, criterionId: string | null, note: string) {
  return call("guest_request_vip", { token, criterion: criterionId, note }, token);
}

export async function guestReplyVip(token: string, message: string) {
  return call("guest_reply_vip", { token, message }, token);
}

/**
 * Favori d'un lieu, lié au SÉJOUR (retrouvé sur tout appareil qui ouvre le lien) ; lien expiré ou révoqué → refusé.
 * Ne déclenche aucun envoi (pas de passage par la file d'e-mails).
 */
export async function guestFavorite(token: string, placeId: string, fav: boolean): Promise<GuestResult> {
  const { data, error } = await supabaseAnon().rpc("guest_place_favorite", { token, place: placeId, fav });
  if (error) return { ok: false, error: error.code === "PGRST202" ? "unavailable" : "server" };
  const res = data as Rpc;
  if (res.status !== "ok") return { ok: false, error: "unavailable" };
  return { ok: true };
}

/**
 * Notifications push du voyageur (migration 33) : liées au SÉJOUR, jamais à un compte. Inscription décidée par le
 * voyageur lui-même ; lien expiré ou révoqué → refusé. Les messages restent neutres (aucun contenu, aucun nom).
 */
const validEndpoint = (ep: string) => /^https:\/\/[^\s/]+\/\S{8,}$/.test(ep) && ep.length <= 1000;
export async function guestPushSubscribe(token: string, input: { endpoint: string; p256dh: string; auth: string }): Promise<GuestResult> {
  if (!validEndpoint(input.endpoint) || !/^[A-Za-z0-9_-]{40,200}$/.test(input.p256dh) || !/^[A-Za-z0-9_-]{8,100}$/.test(input.auth)) return { ok: false, error: "invalid" };
  const { data, error } = await supabaseAnon().rpc("guest_push_subscribe", { token, ep: input.endpoint, key_p256dh: input.p256dh, key_auth: input.auth });
  if (error) return { ok: false, error: error.code === "PGRST202" ? "unavailable" : "server" };
  return (data as Rpc).status === "ok" ? { ok: true } : { ok: false, error: "unavailable" };
}
export async function guestPushUnsubscribe(token: string, endpoint: string): Promise<GuestResult> {
  if (!validEndpoint(endpoint)) return { ok: false, error: "invalid" };
  const { data, error } = await supabaseAnon().rpc("guest_push_unsubscribe", { token, ep: endpoint });
  if (error) return { ok: false, error: error.code === "PGRST202" ? "unavailable" : "server" };
  return (data as Rpc).status === "ok" ? { ok: true } : { ok: false, error: "unavailable" };
}
/** Ce navigateur est-il inscrit pour ce séjour ? (vérifié côté base, pas seulement dans le navigateur) */
export async function guestPushState(token: string, endpoint: string): Promise<boolean | null> {
  if (!validEndpoint(endpoint)) return null;
  const { data, error } = await supabaseAnon().rpc("guest_push_state", { token, ep: endpoint });
  if (error || (data as { status: string }).status !== "ok") return null;
  return Boolean((data as { subscribed?: boolean }).subscribed);
}
