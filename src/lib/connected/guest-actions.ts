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
