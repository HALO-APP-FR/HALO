"use server";

/**
 * Notifications push (migration 28) : chacun inscrit SES appareils, choisit SES événements, et peut envoyer un essai
 * à SES appareils seulement (jamais à un autre membre, jamais à un voyageur).
 */
import { revalidatePath } from "next/cache";
import { getContext } from "./context";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { PUSH_EVENTS, pushMessage, sendPush, type PushResult } from "./push";
import type { Result } from "./actions";

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const code = (e: { code?: string } | null) => (!e ? "unknown" : e.code === "PGRST202" || e.code === "42P01" || e.code === "PGRST205" ? "migration_missing" : e.code === "42501" ? "forbidden" : e.code === "22023" || e.code === "23514" ? "invalid" : "server");
const appUrl = () => process.env.APP_URL ?? (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

export async function subscribePush(input: { endpoint: string; p256dh: string; auth: string; label: string }): Promise<Result<{ id: string }>> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  if (!/^https:\/\//.test(input.endpoint)) return fail("invalid");
  const { data, error } = await ctx.supabase.rpc("push_subscribe", { ep: input.endpoint, key_p256dh: input.p256dh, key_auth: input.auth, device: input.label.slice(0, 80) });
  if (error) return fail(code(error));
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

export async function unsubscribePush(endpoint: string): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  const { error } = await ctx.supabase.rpc("push_unsubscribe", { ep: endpoint });
  if (error) return fail(code(error));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function setPushPref(event: string, on: boolean): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  if (!PUSH_EVENTS.has(event)) return fail("invalid");
  const { error } = await ctx.supabase.rpc("set_push_pref", { org: ctx.org.id, ev: event, by_push: on });
  if (error) return fail(code(error));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

/** Essai vers les appareils de la personne connectée uniquement ; résultat réel par appareil. */
export async function sendTestPush(): Promise<Result<{ results: PushResult[] }>> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  const admin = supabaseAdmin();
  if (!admin) return fail("server");
  const { data: subs, error } = await admin.from("push_subscriptions").select("id, endpoint, p256dh, auth").eq("user_id", ctx.user.id).is("disabled_at", null);
  if (error) return fail(code(error));
  if (!subs?.length) return fail("no_device");
  const locale = (ctx.profile as { locale?: string } | null)?.locale ?? "fr";
  const results = await sendPush(admin, subs as { id: string; endpoint: string; p256dh: string; auth: string }[], await pushMessage("test", locale, { path: "/app/preferences" }, appUrl()));
  await admin.from("push_deliveries").insert(results.map((r) => ({ organization_id: ctx.org?.id ?? null, user_id: ctx.user!.id, subscription_id: r.subscriptionId, category: "test", status: r.status, error: r.error })));
  revalidatePath("/", "layout");
  return { ok: true, data: { results } };
}
