import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { arrivalControl, arrivalCounts, type ArrivalRow } from "@/lib/engine/arrival-control";
import { toReservation, toTask, type Row } from "@/lib/connected/mappers";
import type { Alert, ServiceRequest } from "@/lib/domain/types";
import type { supabaseServer } from "@/lib/supabase/server";
import { CreateCleaningButton, PlanLinenForm } from "./create-cleaning-button";
import { cn } from "@/lib/utils";
import { blockingAbsences } from "@/lib/engine/availability";
import type { PlanningAlerts } from "@/lib/connected/planning";

type Client = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * « Le logement sera-t-il prêt ? » pour les arrivées des 48 prochaines heures, à partir des données RÉELLES :
 * ménage (assigné, commencé, terminé, validé), incidents ouverts, demandes en attente.
 * Même moteur que le poste de pilotage de la démo ; aucune case « prêt » déclarative.
 */
export async function ArrivalsNow({ supabase, orgId, now, linenRequired, planning }: { supabase: Client; orgId: string; now: Date; linenRequired: boolean; planning?: PlanningAlerts }) {
  const t = await getTranslations("arrivals");
  const tc = await getTranslations("connected.home");
  const ti = await getTranslations("connected.incidents.category");
  const tk = await getTranslations("serviceKind");
  const tts = await getTranslations("taskStatus");
  const from = new Date(now.getTime() - 12 * 3_600_000).toISOString();
  const to = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const { data: stays } = await supabase
    .from("reservations")
    .select("*, properties(name, timezone)")
    .eq("organization_id", orgId)
    .eq("status", "confirmed")
    .gte("check_in_at", from)
    .lte("check_in_at", to)
    .order("check_in_at");
  if (!stays?.length) return <p className="text-[15px] text-muted" data-testid="arrivals-none">{tc("noArrivals")}</p>;
  const ids = stays.map((s) => s.id as string);
  const props = Array.from(new Set(stays.map((s) => s.property_id as string)));
  const [{ data: tasks }, { data: incidents }, { data: services }, { data: members }, { data: prep }] = await Promise.all([
    supabase.from("tasks").select("*").eq("organization_id", orgId).in("next_reservation_id", ids),
    supabase.from("incidents").select("id, property_id, reservation_id, task_id, source, category, description, urgent, status, taken_by, created_at").eq("organization_id", orgId).in("property_id", props).neq("status", "resolved"),
    supabase.from("service_requests").select("id, property_id, reservation_id, kind, start_at, status, source, created_at").eq("organization_id", orgId).in("reservation_id", ids).in("status", ["requested", "info_requested", "in_review"]),
    supabase.from("memberships").select("user_id, role, is_active, profiles(full_name)").eq("organization_id", orgId),
    supabase.from("stay_prep_actions").select("reservation_id, title, assignee_id, due_at").eq("organization_id", orgId).in("reservation_id", ids).eq("status", "open").eq("blocking", true),
  ]);
  const alerts: Alert[] = (incidents ?? []).map((i) => ({
    id: i.id,
    propertyId: i.property_id,
    reservationId: i.reservation_id ?? undefined,
    taskId: i.task_id ?? undefined,
    source: i.source,
    category: "other",
    description: i.description,
    urgent: i.urgent,
    status: i.status,
    photoIds: [],
    createdAt: i.created_at,
    takenBy: i.taken_by ?? undefined,
  }));
  const svc: ServiceRequest[] = (services ?? []).map((s) => ({ id: s.id, propertyId: s.property_id, reservationId: s.reservation_id ?? undefined, kind: s.kind, startAt: s.start_at, status: s.status, source: s.source, createdAt: s.created_at }));
  const rows = arrivalControl({ stays: stays.map((s) => toReservation(s as Row)), tasks: (tasks ?? []).map((x) => toTask(x as Row)), alerts, services: svc, now, steps: { linenRequired }, prepBlocking: (prep ?? []).map((a) => ({ reservationId: a.reservation_id as string, title: a.title as string, assigneeId: (a.assignee_id as string | null) ?? null, dueAt: (a.due_at as string | null) ?? null })),
    // Absence acceptée de la personne affectée sur ce créneau : la mission n'est pas réellement couverte
    assigneeAbsent: planning
      ? (task) => {
          const m = planning.members.find((x) => x.id === task.assigneeId);
          return Boolean(m && blockingAbsences(m, task, planning.absences).length);
        }
      : undefined,
  });
  const counts = arrivalCounts(rows);
  const nameOf = new Map((members ?? []).map((m: { user_id: string; profiles: unknown }) => [m.user_id, ((Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null)?.full_name || "—"]));
  const tzOf = new Map(stays.map((s) => [s.id as string, ((Array.isArray(s.properties) ? s.properties[0] : s.properties) as { timezone?: string | null } | null)?.timezone ?? undefined]));
  const propName = new Map(stays.map((s) => [s.id as string, ((Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string } | null)?.name ?? ""]));
  const dur = (min: number) => {
    const m = Math.abs(min);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
  };
  const href = (row: ArrivalRow) => {
    const a = row.blockers[0]?.action;
    if (!a) return `/app/stays/${row.stay.id}`;
    if (a.kind === "assign" || a.kind === "open_task" || a.kind === "review") return `/app/missions/${a.taskId}`;
    if (a.kind === "open_incident") return "/app/incidents";
    if (a.kind === "open_service") return `/app/services/${a.serviceId}`;
    return `/app/stays/${row.stay.id}`;
  };
  // Cause lisible, issue des données réelles (catégorie et description de l'incident, type de demande)
  const incCat = new Map((incidents ?? []).map((i) => [i.id as string, i.category as string]));
  const cause = (x: ArrivalRow["blockers"][number]) => {
    if (x.kind.startsWith("step_")) return t(`blocker.${x.kind}`, { step: t(`step.${x.detail}`) });
    if (x.kind === "prep_blocking") return t("blocker.prep_blocking", { title: String(x.detail ?? "") });
    if ((x.kind === "open_incident" || x.kind === "urgent_incident") && x.action.kind === "open_incident") {
      const d = String(x.detail ?? "");
      return t("blocker.incident_detail", { category: ti(incCat.get(x.action.alertId) ?? "other"), text: d.length > 80 ? `${d.slice(0, 80)}…` : d });
    }
    if (x.kind === "service_pending" && x.detail) return t("blocker.service_detail", { kind: tk(String(x.detail)) });
    return t(`blocker.${x.kind}`);
  };
  const tone = { blocked: "bg-danger-soft text-danger", watch: "bg-warning-soft text-warning", preparing: "bg-accent-soft text-accent-text", ready: "bg-success-soft text-success" } as const;
  const todo = rows.filter((r) => r.state !== "ready");
  return (
    <div>
      <p className="mb-3 flex flex-wrap gap-2 text-[13px]" data-testid="arrival-counts">
        {(["blocked", "watch", "preparing", "ready"] as const).filter((k) => counts[k] > 0).map((k) => (
          <span key={k} className={cn("rounded-full px-2.5 py-1 font-semibold", tone[k])}>
            {t(`state.${k}`)} · {counts[k]}
          </span>
        ))}
      </p>
      <Card className="divide-y divide-line">
        {todo.length === 0 && <p className="p-4 text-[15px] text-muted">{tc("allReady")}</p>}
        {todo.map((row) => {
          const b = row.blockers[0];
          const who = b?.responsible.kind === "member" ? t("responsible", { name: nameOf.get(b.responsible.id) ?? "—" }) : b?.responsible.kind === "manager" ? t("responsible", { name: tc("you") }) : b ? t("responsible", { name: t("responsibleNobody") }) : null;
          return (
            <div key={row.stay.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5" data-testid="arrival-row" data-state={row.state}>
              <span className="min-w-[14rem] flex-1">
                <span className={cn("mb-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold", tone[row.state])}>{t(`state.${row.state}`)}</span>
                <span className="block text-[15px] font-medium">
                  {row.stay.guestName || "—"} · {propName.get(row.stay.id)} · {row.minutesLeft >= 0 ? t("inTime", { time: dur(row.minutesLeft) }) : t("passed", { time: dur(row.minutesLeft) })}
                </span>
                {/* Où en est la préparation : ménage (statut réel, qui), étapes encore à faire */}
                {row.cleaning && (
                  <span className="block text-[13px] text-muted" data-testid="arrival-cleaning" data-status={row.cleaning.status}>
                    {tc("cleaningLine", {
                      status: tts(row.cleaning.status),
                      who: row.cleaning.assigneeId ? (nameOf.get(row.cleaning.assigneeId) ?? "—") : tc("nobody"),
                    })}
                  </span>
                )}
                {row.pending.length > 0 && (
                  <span className="block text-[13px] text-muted" data-testid="arrival-pending">
                    {tc("pending", { steps: row.pending.map((p) => t(`step.${p}`)).join(", ") })}
                  </span>
                )}
                {!b && row.state === "preparing" && (
                  <span className="block text-[13px] text-muted" data-testid="arrival-why-not-ready">
                    {tc("whyNotReady")}
                  </span>
                )}
                {b && (
                  <ul className="mt-0.5 space-y-0.5 text-[13px] text-muted" data-testid="arrival-causes">
                    {row.blockers.slice(0, 5).map((x, i) => (
                      <li key={i} data-kind={x.kind}>
                        {cause(x)}
                        {i === 0 ? ` · ${who}` : ""}
                      </li>
                    ))}
                    {row.blockers.length > 5 && <li>{tc("moreCauses", { count: row.blockers.length - 5 })}</li>}
                  </ul>
                )}
              </span>
              {b?.action.kind === "create_cleaning" ? (
                <CreateCleaningButton stayId={row.stay.id} label={t("action.create_cleaning")} />
              ) : b?.action.kind === "create_linen" ? (
                <PlanLinenForm
                  stayId={row.stay.id}
                  label={t("action.create_linen")}
                  checkInAt={row.stay.checkInAt}
                  propertyName={propName.get(row.stay.id) ?? ""}
                  guestName={row.stay.guestName ?? ""}
                  members={(members ?? []).filter((m: { is_active?: boolean }) => m.is_active !== false).map((m: { user_id: string }) => ({ id: m.user_id, name: nameOf.get(m.user_id) ?? "—" }))}
                  timeZone={tzOf.get(row.stay.id)}
                />
              ) : b ? (
                <Link href={href(row)} className="inline-flex items-center gap-1 text-[14px] font-medium text-accent-text hover:underline" data-testid="arrival-action">
                  {t(`action.${b.action.kind}`)}
                  <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Link>
              ) : (
                <Link href={`/app/stays/${row.stay.id}`} className="inline-flex items-center gap-1 text-[14px] font-medium text-accent-text hover:underline" data-testid="arrival-open-stay">
                  {t("action.open_stay")}
                  <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Link>
              )}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
