import "server-only";
/**
 * Alertes de planning d'une organisation, calculées à chaque affichage à partir des données réelles :
 * - conflits de créneau (ménage impossible : séjours trop rapprochés, chevauchement, durée invalide) ;
 * - missions à réorganiser à cause d'une absence ou d'une fermeture (jamais modifiées automatiquement) ;
 * - demandes d'absence en attente ; séjours pendant une fermeture d'équipe.
 * La base reste la seule autorité pour l'affectation (déclencheur check_assignee_available).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { scheduleConflicts, type ScheduleConflict } from "@/lib/engine/tasks";
import { availabilityConflicts, staysDuringClosures, type Absence, type AvailabilityConflict, type Member } from "@/lib/engine/availability";
import { toProperty, toReservation, type Row } from "./mappers";

export const toAbsence = (r: Row): Absence => ({
  id: r.id as string,
  scope: r.scope as Absence["scope"],
  memberId: (r.member_id as string) ?? null,
  teamPosition: (r.team_position as string) ?? null,
  kind: r.kind as Absence["kind"],
  startsAt: r.starts_at as string,
  endsAt: r.ends_at as string,
  status: r.status as Absence["status"],
});

export interface PlanningAlerts {
  schedule: (ScheduleConflict & { propertyName: string })[];
  availability: AvailabilityConflict[];
  pendingAbsences: number;
  closureStays: { id: string; checkInAt: string; checkOutAt: string; guestName?: string }[];
  absences: (Absence & { reason: string | null; unplanned: boolean; createdAt: string })[];
  members: (Member & { name: string })[];
}

export async function loadPlanning(supabase: SupabaseClient, orgId: string, now: Date): Promise<PlanningAlerts> {
  const since = new Date(now.getTime() - 86_400_000).toISOString();
  const until = new Date(now.getTime() + 90 * 86_400_000).toISOString();
  const [{ data: props }, { data: stays }, { data: tasks }, { data: abs }, { data: mem }] = await Promise.all([
    supabase.from("properties").select("*").eq("organization_id", orgId).is("archived_at", null),
    supabase.from("reservations").select("*").eq("organization_id", orgId).eq("status", "confirmed").gte("check_out_at", since).lte("check_in_at", until),
    supabase.from("tasks").select("id, assignee_id, status, window_start, window_end, duration_min, scheduled_start").eq("organization_id", orgId).in("status", ["unassigned", "assigned", "in_progress", "to_redo"]).gte("window_end", now.toISOString()),
    supabase.from("absences").select("*").eq("organization_id", orgId).in("status", ["pending", "accepted"]).gte("ends_at", since).order("starts_at"),
    supabase.from("memberships").select("user_id, position, profiles(full_name)").eq("organization_id", orgId).eq("is_active", true),
  ]);
  const reservations = (stays ?? []).map(toReservation);
  const schedule = (props ?? []).flatMap((p) =>
    scheduleConflicts(toProperty(p), reservations, now).map((c) => ({ ...c, propertyName: p.name as string })),
  );
  const members = (mem ?? []).map((m: { user_id: string; position: string | null; profiles: unknown }) => ({
    id: m.user_id,
    position: m.position,
    name: ((Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null)?.full_name ?? "",
  }));
  const absences = (abs ?? []).map((r) => ({ ...toAbsence(r), reason: (r.reason as string) ?? null, unplanned: Boolean(r.unplanned), createdAt: r.created_at as string }));
  const availability = availabilityConflicts(
    (tasks ?? []).map((k) => ({ id: k.id, assigneeId: k.assignee_id, status: k.status, windowStart: k.window_start, windowEnd: k.window_end, durationMin: k.duration_min, scheduledStart: k.scheduled_start })),
    members,
    absences,
    now,
  );
  return {
    schedule,
    availability,
    pendingAbsences: absences.filter((a) => a.status === "pending").length,
    closureStays: staysDuringClosures(reservations, absences),
    absences,
    members,
  };
}
