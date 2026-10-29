"use server";

/**
 * Actions de l'environnement connecté (managers et agents).
 * Toutes utilisent la SESSION de la personne : la base applique ses règles d'accès.
 * Le contrôle de rôle ici est un second filet (message clair), jamais la seule protection.
 * Chaque action renvoie un résultat réel : en cas d'échec, l'interface l'affiche, rien n'est simulé.
 */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { planTasks } from "@/lib/engine/tasks";
import { infeasibility } from "@/lib/engine/conflicts";
import { getContext, isManagerRole, ORG_COOKIE } from "./context";
import { toProperty, toReservation, toTask } from "./mappers";
import { processOutbox } from "./outbox";

export type Result<T = undefined> = { ok: true; data: T } | { ok: false; error: string };
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
const errCode = (e: { code?: string; message?: string } | null) =>
  !e ? "unknown" : e.code === "42501" ? "forbidden" : e.code === "23505" ? "duplicate" : e.code === "23514" || e.code === "22023" ? "invalid" : e.code === "P0002" ? "not_found" : "server";

/** Codes métier remontés par la base (message de l'exception), sinon le code générique. */
const dbCode = (e: { code?: string; message?: string } | null, known: string[]) => known.find((k) => e?.message?.includes(k)) ?? errCode(e);

async function manager() {
  const ctx = await getContext();
  if (!ctx.user) return { ctx, error: "not_signed_in" as const };
  if (!ctx.org || !isManagerRole(ctx.org.role)) return { ctx, error: "forbidden" as const };
  return { ctx, error: null };
}

// ---------- Organisation et onboarding ----------
export async function createOrganization(name: string): Promise<Result<{ id: string }>> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  if (!name.trim()) return fail("invalid");
  const { data, error } = await ctx.supabase.rpc("create_organization", { org_name: name.trim().slice(0, 120) });
  if (error) return fail(errCode(error));
  (await cookies()).set(ORG_COOKIE, data as string, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

export async function setActiveOrganization(orgId: string): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.orgs.some((o) => o.id === orgId)) return fail("forbidden");
  (await cookies()).set(ORG_COOKIE, orgId, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export interface OnboardingSave {
  profile?: { full_name?: string; job_title?: string; phone?: string };
  org?: Partial<{
    name: string;
    legal_name: string;
    country_code: string;
    address_line: string;
    postal_code: string;
    city: string;
    activity_type: string;
    unit_count: number | null;
    cleaning_model: string;
    linen_model: string;
    services_offered: string[];
    frequent_issues: string[];
    tools: string[];
  }>;
  /** Réponses sans colonne dédiée (politique de validation, accueil, contrôle des chambres). */
  answers?: Record<string, string | boolean | null>;
  state: { step: string; skipped?: string[]; completed?: boolean };
}

/** Enregistre une étape de l'onboarding (réponses conservées, reprise possible plus tard). */
export async function saveOnboarding(input: OnboardingSave): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const org = ctx.org!;
  if (input.profile && Object.keys(input.profile).length) {
    const { error: e } = await ctx.supabase.from("profiles").update(input.profile).eq("id", ctx.user!.id);
    if (e) return fail(errCode(e));
  }
  const prev = org.onboarding ?? {};
  const onboarding = {
    ...prev,
    step: input.state.step,
    answers: { ...((prev.answers as Record<string, unknown>) ?? {}), ...(input.answers ?? {}) },
    skipped: Array.from(new Set([...((prev.skipped as string[]) ?? []), ...(input.state.skipped ?? [])])),
    ...(input.state.completed ? { completed_at: new Date().toISOString() } : {}),
  };
  const { error: e } = await ctx.supabase.from("organizations").update({ ...(input.org ?? {}), onboarding }).eq("id", org.id);
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export interface ApplyConfig {
  validation_task_types?: string[];
  default_checklist?: { room: string; items: { label: string; photo_required: boolean }[] }[];
  services_offered?: string[];
  linen_turnaround_days?: number;
  task_types?: string[];
  alerts?: string[];
  decisions: Record<string, "accepted" | "modified" | "ignored">;
}

/** Applique la configuration proposée, uniquement ce que la personne a confirmé. */
export async function applyConfiguration(input: ApplyConfig): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const org = ctx.org!;
  const prevConfig = ((org.onboarding ?? {}).config as Record<string, unknown>) ?? {};
  const config = { ...prevConfig, ...(input.task_types ? { task_types: input.task_types } : {}), ...(input.alerts ? { alerts: input.alerts } : {}) };
  const patch: Record<string, unknown> = {
    onboarding: { ...(org.onboarding ?? {}), config, proposals: input.decisions, applied_at: new Date().toISOString(), completed_at: new Date().toISOString(), step: "done" },
  };
  if (input.validation_task_types) patch.validation_task_types = input.validation_task_types;
  if (input.default_checklist) patch.default_checklist = input.default_checklist;
  if (input.services_offered) patch.services_offered = input.services_offered;
  if (input.linen_turnaround_days !== undefined) patch.linen_turnaround_days = input.linen_turnaround_days;
  const { error: e } = await ctx.supabase.from("organizations").update(patch).eq("id", org.id);
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Logements ----------
export interface PropertyInput {
  name: string;
  address_line?: string;
  postal_code?: string;
  city?: string;
  timezone: string;
  cleaning_duration_min: number;
  default_check_in: string;
  default_check_out: string;
}

export async function createProperty(input: PropertyInput): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const org = ctx.org!;
  if (!input.name.trim()) return fail("invalid");
  // Catégories de missions confirmées à l'onboarding : accueil / départ activés par défaut
  const types = (((org.onboarding ?? {}).config as { task_types?: string[] } | undefined)?.task_types ?? []) as string[];
  const { data, error: e } = await ctx.supabase
    .from("properties")
    .insert({ organization_id: org.id, ...input, name: input.name.trim(), check_in_service: types.includes("check_in"), check_out_service: types.includes("check_out") })
    .select("id")
    .single();
  if (e) return fail(errCode(e));
  const id = data.id as string;
  // Livret du logement (vide, à compléter) et checklist type de l'organisation
  const { error: g } = await ctx.supabase.from("guest_guides").insert({ organization_id: org.id, property_id: id, enabled: true });
  if (g) return fail(errCode(g));
  const { data: o } = await ctx.supabase.from("organizations").select("default_checklist").eq("id", org.id).single();
  const rooms = (o?.default_checklist ?? []) as { room: string; items: { label: string; photo_required: boolean }[] }[];
  for (const [i, room] of rooms.entries()) {
    const { data: r, error: re } = await ctx.supabase.from("checklist_rooms").insert({ organization_id: org.id, property_id: id, name: room.room, sort: i }).select("id").single();
    if (re || !r) return fail(errCode(re));
    if (room.items.length) {
      const { error: ie } = await ctx.supabase
        .from("checklist_items")
        .insert(room.items.map((it, j) => ({ organization_id: org.id, room_id: r.id, label: it.label, photo_required: it.photo_required, sort: j })));
      if (ie) return fail(errCode(ie));
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, data: { id } };
}

export async function updateGuide(propertyId: string, guide: Record<string, string | boolean | null>): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const allowed = ["enabled", "welcome", "wifi_name", "wifi_password", "house_rules", "checkout_instructions", "parking", "trash", "emergency_phone", "recommendations"];
  const clean = Object.fromEntries(Object.entries(guide).filter(([k]) => allowed.includes(k)));
  const { error: e } = await ctx.supabase.from("guest_guides").upsert({ organization_id: ctx.org!.id, property_id: propertyId, ...clean, updated_at: new Date().toISOString() });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Séjours et missions ----------
export interface StayInput {
  property_id: string;
  guest_name?: string;
  guest_email?: string;
  guest_locale?: string;
  adults: number;
  children: number;
  babies: number;
  check_in_at: string;
  check_out_at: string;
}

export async function createStay(input: StayInput): Promise<Result<{ id: string; tasksCreated: number }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  if (new Date(input.check_out_at) <= new Date(input.check_in_at)) return fail("invalid_dates");
  const { data, error: e } = await ctx.supabase
    .from("reservations")
    .insert({ organization_id: ctx.org!.id, ...input, guest_email: input.guest_email?.trim() || null, guest_name: input.guest_name?.trim() || null })
    .select("id")
    .single();
  if (e) return fail(dbCode(e, ["stay_overlap"]));
  const plan = await syncTasks(input.property_id);
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id as string, tasksCreated: plan.ok ? plan.data.created : 0 } };
}

/** Recalcule les missions automatiques d'un logement avec le moteur existant (même règles que la démo). */
export async function syncTasks(propertyId: string): Promise<Result<{ created: number; updated: number; cancelled: number }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const org = ctx.org!.id;
  const [{ data: p }, { data: rs }, { data: ts }] = await Promise.all([
    ctx.supabase.from("properties").select("*").eq("organization_id", org).eq("id", propertyId).single(),
    ctx.supabase.from("reservations").select("*").eq("organization_id", org).eq("property_id", propertyId),
    ctx.supabase.from("tasks").select("*").eq("organization_id", org).eq("property_id", propertyId),
  ]);
  if (!p) return fail("not_found");
  const plan = planTasks(toProperty(p), (rs ?? []).map(toReservation), (ts ?? []).map(toTask), new Date());
  for (const d of plan.create) {
    const { error: e } = await ctx.supabase.from("tasks").insert({
      organization_id: org,
      property_id: d.propertyId,
      reservation_id: d.reservationId,
      next_reservation_id: d.nextReservationId ?? null,
      type: d.type,
      priority: d.priority,
      is_auto_generated: true,
      window_start: d.windowStart,
      window_end: d.windowEnd,
      duration_min: d.durationMin,
      guests_count: d.guestsCount ?? null,
      babies: d.babies ?? 0,
      pets: d.pets ?? 0,
      vip: d.vip ?? false,
    });
    if (e) return fail(errCode(e));
  }
  for (const u of plan.update) {
    const p2 = u.patch;
    const row: Record<string, unknown> = {};
    if (p2.windowStart) row.window_start = p2.windowStart;
    if (p2.windowEnd) row.window_end = p2.windowEnd;
    if (p2.priority) row.priority = p2.priority;
    if ("nextReservationId" in p2) row.next_reservation_id = p2.nextReservationId ?? null;
    if ("guestsCount" in p2) row.guests_count = p2.guestsCount ?? null;
    if ("babies" in p2) row.babies = p2.babies ?? 0;
    if ("pets" in p2) row.pets = p2.pets ?? 0;
    if ("vip" in p2) row.vip = p2.vip ?? false;
    if (p2.durationMin) row.duration_min = p2.durationMin;
    const { error: ue } = await ctx.supabase.from("tasks").update(row).eq("organization_id", org).eq("id", u.id);
    if (ue) return fail(errCode(ue));
  }
  if (plan.cancel.length) {
    const { error: ce } = await ctx.supabase.from("tasks").update({ status: "cancelled" }).eq("organization_id", org).in("id", plan.cancel);
    if (ce) return fail(errCode(ce));
  }
  return { ok: true, data: { created: plan.create.length, updated: plan.update.length, cancelled: plan.cancel.length } };
}

export async function assignTask(taskId: string, memberId: string | null, newWindowEnd?: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const patch: Record<string, unknown> = { assignee_id: memberId, status: memberId ? "assigned" : "unassigned" };
  if (memberId) {
    // Affectation hors fenêtre : jamais silencieuse ; le responsable doit fixer une nouvelle fin de fenêtre
    const { data: t } = await ctx.supabase.from("tasks").select("*").eq("organization_id", o).eq("id", taskId).maybeSingle();
    if (!t) return fail("not_found");
    const issue = infeasibility(toTask(t), new Date());
    if (issue && !newWindowEnd) return fail("out_of_window");
    if (newWindowEnd) {
      const end = new Date(newWindowEnd).getTime();
      if (!(end > Date.now() + (t.duration_min as number) * 60_000)) return fail("invalid_window");
      patch.window_end = new Date(end).toISOString();
      if (new Date(t.window_start as string).getTime() > end) patch.window_start = new Date().toISOString();
      patch.is_auto_generated = false; // décision explicite du responsable : la synchro automatique ne la remplace pas
    }
  }
  const { error: e } = await ctx.supabase.from("tasks").update(patch).eq("organization_id", o).eq("id", taskId).in("status", ["unassigned", "assigned"]);
  if (e) return fail(dbCode(e, ["assignee_unavailable", "invalid_window"]));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Agent : ses missions uniquement (fonctions contrôlées par la base) ----------
export async function agentTaskAction(taskId: string, kind: "start" | "finish"): Promise<Result<{ result: string }>> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const fn = kind === "start" ? "start_task" : "finish_task";
  const { data, error: e } = await ctx.supabase.rpc(fn, { org: ctx.org.id, task: taskId, action_id: randomUUID(), client_at: new Date().toISOString() });
  if (e) return fail(errCode(e));
  const result = data as string;
  if (result !== "applied" && result !== "already") return fail(result);
  revalidatePath("/", "layout");
  return { ok: true, data: { result } };
}

// ---------- Lien voyageur ----------
export async function createGuestLink(reservationId: string): Promise<Result<{ token: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("create_guest_link", { org: ctx.org!.id, reservation: reservationId });
  if (e) return fail(e.message?.includes("stay_ended") ? "stay_ended" : e.message?.includes("stay_not_confirmed") ? "stay_not_confirmed" : errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: { token: data as string } };
}

export async function revokeGuestLink(linkId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("revoke_guest_link", { org: ctx.org!.id, link: linkId });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function extendGuestLink(linkId: string, until: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("extend_guest_link", { org: ctx.org!.id, link: linkId, new_until: until });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Prestations et messages ----------
export async function decideService(
  serviceId: string,
  status: "confirmed" | "declined" | "info_requested" | "done" | "cancelled",
  guestMessage: string,
  internalNote: string,
): Promise<Result<{ emailQueued: boolean }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("decide_service", {
    org: ctx.org!.id,
    service: serviceId,
    new_status: status,
    guest_message: guestMessage || null,
    internal_note: internalNote || null,
  });
  if (e) return fail(e.message?.includes("question_required") ? "question_required" : errCode(e));
  const res = data as { status: string; email_queued?: boolean; current?: string };
  if (res.status !== "ok") return fail(`conflict:${res.current}`);
  if (res.email_queued) await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { emailQueued: Boolean(res.email_queued) } };
}

export async function updateService(serviceId: string, startAt: string, people: number | null, guestMessage: string): Promise<Result<{ emailQueued: boolean }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("update_service", { org: ctx.org!.id, service: serviceId, new_start_at: startAt, new_people: people, guest_message: guestMessage || null });
  if (e) return fail(errCode(e));
  const res = data as { status: string; email_queued?: boolean; current?: string };
  if (res.status === "unchanged") return fail("unchanged");
  if (res.status !== "ok") return fail(`conflict:${res.current}`);
  if (res.email_queued) await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { emailQueued: Boolean(res.email_queued) } };
}

export async function markServiceSeen(serviceId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("mark_service_seen", { org: ctx.org!.id, service: serviceId });
  if (e) return fail(errCode(e));
  return { ok: true, data: undefined };
}

export async function replyStayMessage(reservationId: string, message: string): Promise<Result<{ emailQueued: boolean }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("reply_stay_message", { org: ctx.org!.id, reservation: reservationId, message });
  if (e) return fail(errCode(e));
  const res = data as { email_queued?: boolean };
  if (res.email_queued) await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { emailQueued: Boolean(res.email_queued) } };
}

export async function retryNotification(notificationId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { error: e } = await ctx.supabase.rpc("retry_notification", { org: ctx.org!.id, notification: notificationId });
  if (e) return fail(errCode(e));
  await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Équipe ----------
export async function inviteMember(role: "agent" | "manager", position: string | null): Promise<Result<{ token: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("create_invitation", { org: ctx.org!.id, invite_role: role, invite_position: position });
  if (e) return fail(errCode(e));
  return { ok: true, data: { token: data as string } };
}

export async function acceptInvitation(token: string, fullName: string, phone?: string): Promise<Result<{ orgId: string }>> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  if (!fullName.trim()) return fail("name_required");
  const { data, error: e } = await ctx.supabase.rpc("accept_invitation", { raw_token: token, member_name: fullName.trim(), member_phone: phone?.trim() || null });
  if (e) return fail(e.message?.includes("already_member") ? "already_member" : e.message?.includes("name_required") ? "name_required" : "invalid_invitation");
  (await cookies()).set(ORG_COOKIE, data as string, { path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  revalidatePath("/", "layout");
  return { ok: true, data: { orgId: data as string } };
}

// ---------- Compte rendu de mission (agent) et validation (manager) ----------
export async function saveTaskReport(taskId: string, checked: string[]): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const { data, error: e } = await ctx.supabase.rpc("save_task_report", {
    org: ctx.org.id,
    task: taskId,
    report_checked: checked,
    report_rooms: {},
    client_at: new Date().toISOString(),
  });
  if (e) return fail(errCode(e));
  if (data !== "applied") return fail(String(data));
  return { ok: true, data: undefined };
}

/** Réserve l'emplacement d'une photo ; le fichier est ensuite déposé par le navigateur, avec la session de l'agent. */
export async function beginTaskPhoto(taskId: string, itemId: string | null, roomId: string | null, mime: string, size: number): Promise<Result<{ path: string }>> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const { data, error: e } = await ctx.supabase.rpc("begin_upload", {
    org: ctx.org.id,
    f_kind: "task_photo",
    f_mime: mime,
    f_size: size,
    task: taskId,
    item: itemId,
    room: roomId,
  });
  if (e) return fail(e.message?.includes("bad_mime") ? "bad_mime" : errCode(e));
  return { ok: true, data: { path: data as string } };
}

export async function validateTask(taskId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("validate_task", { org: ctx.org!.id, task: taskId });
  if (e) return fail(errCode(e));
  if (data !== "applied") return fail(String(data));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function requestCorrection(taskId: string, reason: string, redoItems: string[] = []): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  // Points à refaire : leur ancienne photo est gardée en historique mais une NOUVELLE preuve est exigée
  const { data, error: e } = await ctx.supabase.rpc("request_correction", { org: ctx.org!.id, task: taskId, reason, redo_items: redoItems.length ? redoItems : null });
  if (e) return fail(e.message?.includes("reason_required") ? "reason_required" : errCode(e));
  if (data !== "applied") return fail(String(data));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Incidents et blocages ----------
export async function reportIncident(taskId: string, category: string, description: string, urgent: boolean): Promise<Result<{ id: string }>> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  if (description.trim().length < 3) return fail("empty");
  const { data, error: e } = await ctx.supabase.rpc("report_incident", { org: ctx.org.id, task: taskId, i_category: category, i_description: description, i_urgent: urgent });
  if (e) return fail(errCode(e));
  await processOutbox(ctx.org.id); // blocage urgent : responsables prévenus
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

export async function takeIncident(incidentId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("take_incident", { org: ctx.org!.id, incident: incidentId });
  if (e) return fail(errCode(e));
  if (data !== "applied") return fail(String(data));
  await processOutbox(ctx.org!.id); // voyageur prévenu de la prise en charge
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

export async function resolveIncident(incidentId: string, resolution: string, guestMessage: string): Promise<Result<{ emailQueued: boolean }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("resolve_incident", { org: ctx.org!.id, incident: incidentId, i_resolution: resolution, i_guest_message: guestMessage || null });
  if (e) return fail(e.message?.includes("resolution_required") ? "resolution_required" : errCode(e));
  const res = data as { status: string; email_queued?: boolean; current?: string };
  if (res.status !== "ok") return fail(`conflict:${res.current}`);
  if (res.email_queued) await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { emailQueued: Boolean(res.email_queued) } };
}

/** Ménage manquant avant une arrivée (premier séjour, séjour ajouté tard) : créé explicitement par le responsable. */
export async function createCleaningForStay(stayId: string): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: r } = await ctx.supabase.from("reservations").select("id, property_id, check_in_at").eq("organization_id", o).eq("id", stayId).maybeSingle();
  if (!r) return fail("not_found");
  const [{ data: p }, { data: prev }] = await Promise.all([
    ctx.supabase.from("properties").select("cleaning_duration_min").eq("organization_id", o).eq("id", r.property_id).single(),
    ctx.supabase.from("reservations").select("check_out_at").eq("organization_id", o).eq("property_id", r.property_id).eq("status", "confirmed").lte("check_out_at", r.check_in_at).order("check_out_at", { ascending: false }).limit(1),
  ]);
  const checkIn = new Date(r.check_in_at).getTime();
  const start = Math.max(Date.now(), prev?.[0] ? new Date(prev[0].check_out_at).getTime() : 0);
  if (start >= checkIn) return fail("too_late");
  const { data, error: e } = await ctx.supabase
    .from("tasks")
    .insert({
      organization_id: o,
      property_id: r.property_id,
      next_reservation_id: r.id,
      type: "turnover",
      is_auto_generated: false,
      window_start: new Date(start).toISOString(),
      window_end: new Date(checkIn).toISOString(),
      duration_min: Math.min(p?.cleaning_duration_min ?? 90, Math.max(5, Math.floor((checkIn - start) / 60_000))),
    })
    .select("id")
    .single();
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id as string } };
}

/** Intervention de maintenance suite à un incident, reliée à la prochaine arrivée du logement. */
export async function createIntervention(incidentId: string, assigneeId: string | null, startAt: string, endAt: string, durationMin: number): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("create_intervention", {
    org: ctx.org!.id,
    incident: incidentId,
    assignee: assigneeId,
    w_start: startAt,
    w_end: endAt,
    duration: durationMin,
  });
  if (e) return fail(e.message?.includes("already_resolved") ? "conflict" : dbCode(e, ["invalid_window", "assignee_unavailable"]));
  await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data as string } };
}

/** Livraison de linge avant une arrivée (organisations avec blanchisserie) : planifiée explicitement. */
export async function planLinenDelivery(stayId: string): Promise<Result<{ id: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: r } = await ctx.supabase.from("reservations").select("id, property_id, check_in_at").eq("organization_id", o).eq("id", stayId).maybeSingle();
  if (!r) return fail("not_found");
  const checkIn = new Date(r.check_in_at).getTime();
  const start = Math.max(Date.now(), checkIn - 24 * 3_600_000);
  if (start >= checkIn) return fail("too_late");
  const { data, error: e } = await ctx.supabase
    .from("tasks")
    .insert({
      organization_id: o,
      property_id: r.property_id,
      next_reservation_id: r.id,
      type: "linen_delivery",
      is_auto_generated: false,
      window_start: new Date(start).toISOString(),
      window_end: new Date(checkIn).toISOString(),
      duration_min: Math.min(20, Math.max(5, Math.floor((checkIn - start) / 60_000))),
    })
    .select("id")
    .single();
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: { id: data.id as string } };
}


// ---------- Réglages : validation par type de mission ----------
const KNOWN_TYPES = ["turnover", "check_in", "check_out", "inspection", "linen_delivery", "linen_pickup", "maintenance", "other"];
/** Types de mission dont la fin passe par « À valider » (appliqué par la base dans finish_task). */
export async function setValidationTypes(types: string[]): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const clean = Array.from(new Set(types.filter((x) => KNOWN_TYPES.includes(x))));
  const { data, error: e } = await ctx.supabase.from("organizations").update({ validation_task_types: clean }).eq("id", ctx.org!.id).select("validation_task_types");
  if (e) return fail(errCode(e));
  if (!data?.length) return fail("forbidden");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Créneau d'une mission (correction par le responsable, tracée) ----------
export async function setTaskWindow(taskId: string, startAt: string, endAt: string, durationMin: number, reason: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const start = new Date(startAt);
  const end = new Date(endAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || !(durationMin >= 5) || end.getTime() < start.getTime() + durationMin * 60_000) return fail("invalid_window");
  const { data, error: e } = await ctx.supabase.rpc("set_task_window", { org: ctx.org!.id, task: taskId, w_start: start.toISOString(), w_end: end.toISOString(), duration: Math.round(durationMin), reason: reason.trim() || null });
  if (e) return fail(dbCode(e, ["invalid_window"]));
  if (data !== "applied") return fail(data as string);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Profil (chacun le sien) ----------
export async function updateMyProfile(fullName: string, phone: string): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  if (!fullName.trim()) return fail("name_required");
  const { error: e } = await ctx.supabase.from("profiles").update({ full_name: fullName.trim().slice(0, 120), phone: phone.trim().slice(0, 32) || null, updated_at: new Date().toISOString() }).eq("id", ctx.user.id);
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Absences et fermetures d'équipe ----------
export interface AbsenceInput {
  /** Identifiant généré par l'écran : rejouer la même demande ne crée pas de doublon. */
  clientId: string;
  scope: "member" | "team";
  memberId: string | null;
  kind: "leave" | "unavailable" | "closure";
  startsAt: string;
  endsAt: string;
  unplanned?: boolean;
  reason?: string;
  teamPosition?: string | null;
}
export async function saveAbsence(input: AbsenceInput): Promise<Result<{ id: string; status: string; replayed: boolean }>> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const start = new Date(input.startsAt);
  const end = new Date(input.endsAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return fail("invalid_period");
  const { data, error: e } = await ctx.supabase.rpc("save_absence", {
    org: ctx.org.id,
    client: input.clientId,
    a_scope: input.scope,
    a_member: input.scope === "member" ? input.memberId ?? ctx.user.id : null,
    a_kind: input.kind,
    a_start: start.toISOString(),
    a_end: end.toISOString(),
    a_unplanned: Boolean(input.unplanned),
    a_reason: input.reason?.trim() || null,
    a_position: input.scope === "team" ? input.teamPosition || null : null,
  });
  if (e) return fail(dbCode(e, ["invalid_period", "not_member", "invalid_kind"]));
  const r = data as { id: string; status: string; replayed: boolean };
  // Responsables prévenus d'une nouvelle demande (journal des envois)
  await processOutbox(ctx.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: r };
}
export async function decideAbsence(absenceId: string, accept: boolean): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("decide_absence", { org: ctx.org!.id, absence: absenceId, accept });
  if (e) return fail(errCode(e));
  if (data !== "applied" && data !== "already") return fail(data as string);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
export async function cancelAbsence(absenceId: string): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const { data, error: e } = await ctx.supabase.rpc("cancel_absence", { org: ctx.org.id, absence: absenceId });
  if (e) return fail(errCode(e));
  if (data !== "applied" && data !== "already") return fail(data as string);
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Lecture des messages voyageur ----------
export async function markStayMessagesRead(reservationId: string, ids: number[] | null): Promise<Result<{ marked: number }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("mark_stay_messages_read", { org: ctx.org!.id, reservation: reservationId, ids: ids?.length ? ids : null });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: { marked: data as number } };
}

/** Application d'itinéraire par défaut de la personne connectée (null = demander à chaque fois). */
export async function updateMapsApp(app: "apple" | "google" | "waze" | null): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user) return fail("not_signed_in");
  if (app !== null && !["apple", "google", "waze"].includes(app)) return fail("invalid");
  const { error: e } = await ctx.supabase.from("profiles").update({ maps_app: app }).eq("id", ctx.user.id);
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Messagerie interne (Manager ↔ Agents), toujours liée à une opération ----------
export interface NewThread {
  clientId: string;
  recipients: string[];
  contextKind: "task" | "property" | "reservation";
  contextId: string;
  body: string;
  urgent: boolean;
}
const chatCodes = ["empty", "no_recipient", "not_member", "invalid_context"];
export async function startTeamThread(input: NewThread): Promise<Result<{ thread: string }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.rpc("start_team_thread", {
    org: ctx.org!.id,
    client: input.clientId,
    recipients: input.recipients,
    ctx_kind: input.contextKind,
    ctx_id: input.contextId,
    body: input.body,
    is_urgent: input.urgent,
  });
  if (e) return fail(dbCode(e, chatCodes));
  await processOutbox(ctx.org!.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { thread: (data as { thread: string }).thread } };
}
/** Envoi confirmé seulement quand la base a enregistré le message (identifiant client : pas de doublon au renvoi). */
export async function postTeamMessage(threadId: string, clientId: string, body: string, urgent: boolean): Promise<Result<{ at: string }>> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const { data, error: e } = await ctx.supabase.rpc("post_team_message", { org: ctx.org.id, thread: threadId, client: clientId, body, is_urgent: urgent });
  if (e) return fail(dbCode(e, chatCodes));
  await processOutbox(ctx.org.id);
  revalidatePath("/", "layout");
  return { ok: true, data: { at: (data as { at: string }).at } };
}
export async function markTeamThreadRead(threadId: string): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const { error: e } = await ctx.supabase.rpc("mark_team_thread_read", { org: ctx.org.id, thread: threadId });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Préférences de notification (chacun les siennes ; appliquées par la base) ----------
export async function setNotificationPref(event: string, email: boolean): Promise<Result> {
  const ctx = await getContext();
  if (!ctx.user || !ctx.org) return fail("not_signed_in");
  const { error: e } = await ctx.supabase.rpc("set_notification_pref", { org: ctx.org.id, ev: event, by_email: email });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}

// ---------- Lieux autour du logement (responsable) ----------
/** Coordonnées du logement : géocodage OpenStreetMap de son adresse, ou saisie manuelle. */
export async function locateProperty(propertyId: string, manual?: { lat: number; lng: number }): Promise<Result<{ lat: number; lng: number }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  let lat: number;
  let lng: number;
  let source: "manager" | "openstreetmap";
  if (manual) {
    if (!(Math.abs(manual.lat) <= 90 && Math.abs(manual.lng) <= 180) || (manual.lat === 0 && manual.lng === 0)) return fail("invalid_coordinates");
    ({ lat, lng } = manual);
    source = "manager";
  } else {
    const { data: p } = await ctx.supabase.from("properties").select("address_line, postal_code, city, country_code").eq("organization_id", o).eq("id", propertyId).maybeSingle();
    if (!p) return fail("not_found");
    const { geocode } = await import("./osm");
    const g = await geocode({ addressLine: p.address_line, postalCode: p.postal_code, city: p.city, countryCode: p.country_code });
    if (!g.ok) return fail(g.error);
    ({ lat, lng } = g);
    source = "openstreetmap";
  }
  const { data, error: e } = await ctx.supabase
    .from("properties")
    .update({ latitude: lat, longitude: lng, geo_source: source, geo_updated_at: new Date().toISOString() })
    .eq("organization_id", o)
    .eq("id", propertyId)
    .select("id");
  if (e) return fail(errCode(e));
  if (!data?.length) return fail("forbidden");
  revalidatePath("/", "layout");
  return { ok: true, data: { lat, lng } };
}

/** Import des lieux OpenStreetMap autour du logement : remplace l'import précédent, garde les lieux masqués et ceux de l'équipe. */
export async function importNearbyPlaces(propertyId: string): Promise<Result<{ count: number; dataDate: string | null }>> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const o = ctx.org!.id;
  const { data: p } = await ctx.supabase.from("properties").select("latitude, longitude").eq("organization_id", o).eq("id", propertyId).maybeSingle();
  if (!p) return fail("not_found");
  if (p.latitude == null || p.longitude == null) return fail("no_coordinates");
  const { nearbyPlaces } = await import("./osm");
  const r = await nearbyPlaces(p.latitude, p.longitude);
  if (!r.ok) return fail(r.error);
  const updatedAt = r.dataDate ?? new Date().toISOString();
  const rows = r.places.map((x) => ({
    organization_id: o,
    property_id: propertyId,
    source: "openstreetmap",
    external_id: x.externalId,
    category: x.category,
    name: x.name,
    address: x.address,
    latitude: x.lat,
    longitude: x.lng,
    opening_hours: x.openingHours,
    phone: x.phone,
    website: x.website,
    source_updated_at: updatedAt,
  }));
  if (rows.length) {
    const { error: ue } = await ctx.supabase.from("property_places").upsert(rows, { onConflict: "property_id,source,external_id" });
    if (ue) return fail(errCode(ue));
  }
  // Lieux qui n'existent plus dans OpenStreetMap : retirés (sauf ceux que l'équipe a masqués, gardés pour mémoire)
  const keep = rows.map((x) => x.external_id);
  let del = ctx.supabase.from("property_places").delete().eq("organization_id", o).eq("property_id", propertyId).eq("source", "openstreetmap").eq("hidden", false);
  if (keep.length) del = del.not("external_id", "in", `(${keep.map((k) => `"${k}"`).join(",")})`);
  const { error: de } = await del;
  if (de) return fail(errCode(de));
  revalidatePath("/", "layout");
  return { ok: true, data: { count: rows.length, dataDate: r.dataDate } };
}

export interface PlaceInput {
  category: string;
  name: string;
  address?: string;
  openingHours?: string;
  phone?: string;
  website?: string;
  note?: string;
  lat?: number | null;
  lng?: number | null;
}
/** Lieu ajouté et vérifié par l'équipe (source « équipe », date du jour). */
export async function addPlace(propertyId: string, input: PlaceInput): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  if (!input.name.trim()) return fail("invalid");
  const { error: e } = await ctx.supabase.from("property_places").insert({
    organization_id: ctx.org!.id,
    property_id: propertyId,
    source: "manager",
    category: input.category,
    name: input.name.trim().slice(0, 160),
    address: input.address?.trim() || null,
    opening_hours: input.openingHours?.trim() || null,
    phone: input.phone?.trim() || null,
    website: input.website?.trim() || null,
    note: input.note?.trim() || null,
    latitude: input.lat ?? null,
    longitude: input.lng ?? null,
    created_by: ctx.user!.id,
  });
  if (e) return fail(errCode(e));
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
export async function setPlaceHidden(placeId: string, hidden: boolean): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.from("property_places").update({ hidden }).eq("organization_id", ctx.org!.id).eq("id", placeId).select("id");
  if (e) return fail(errCode(e));
  if (!data?.length) return fail("not_found");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
export async function deletePlace(placeId: string): Promise<Result> {
  const { ctx, error } = await manager();
  if (error) return fail(error);
  const { data, error: e } = await ctx.supabase.from("property_places").delete().eq("organization_id", ctx.org!.id).eq("id", placeId).eq("source", "manager").select("id");
  if (e) return fail(errCode(e));
  if (!data?.length) return fail("not_found");
  revalidatePath("/", "layout");
  return { ok: true, data: undefined };
}
