import { getTranslations } from "next-intl/server";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { arrivalControl, arrivalCounts, type ArrivalRow } from "@/lib/engine/arrival-control";
import { toReservation, toTask, type Row } from "@/lib/connected/mappers";
import type { Alert, ServiceRequest } from "@/lib/domain/types";
import type { supabaseServer } from "@/lib/supabase/server";
import { CreateCleaningButton } from "./create-cleaning-button";
import { cn } from "@/lib/utils";

type Client = Awaited<ReturnType<typeof supabaseServer>>;

/**
 * « Le logement sera-t-il prêt ? » pour les arrivées des 48 prochaines heures, à partir des données RÉELLES :
 * ménage (assigné, commencé, terminé, validé), incidents ouverts, demandes en attente.
 * Même moteur que le poste de pilotage de la démo ; aucune case « prêt » déclarative.
 */
export async function ArrivalsNow({ supabase, orgId, now, linenRequired }: { supabase: Client; orgId: string; now: Date; linenRequired: boolean }) {
  const t = await getTranslations("arrivals");
  const tc = await getTranslations("connected.home");
  const from = new Date(now.getTime() - 12 * 3_600_000).toISOString();
  const to = new Date(now.getTime() + 48 * 3_600_000).toISOString();
  const { data: stays } = await supabase
    .from("reservations")
    .select("*, properties(name)")
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
    supabase.from("memberships").select("user_id, profiles(full_name)").eq("organization_id", orgId),
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
  const rows = arrivalControl({ stays: stays.map((s) => toReservation(s as Row)), tasks: (tasks ?? []).map((x) => toTask(x as Row)), alerts, services: svc, now, steps: { linenRequired }, prepBlocking: (prep ?? []).map((a) => ({ reservationId: a.reservation_id as string, title: a.title as string, assigneeId: (a.assignee_id as string | null) ?? null, dueAt: (a.due_at as string | null) ?? null })) });
  const counts = arrivalCounts(rows);
  const nameOf = new Map((members ?? []).map((m: { user_id: string; profiles: unknown }) => [m.user_id, ((Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null)?.full_name || "—"]));
  const propName = new Map(stays.map((s) => [s.id as string, ((Array.isArray(s.properties) ? s.properties[0] : s.properties) as { name: string } | null)?.name ?? ""]));
  const dur = (min: number) => {
    const m = Math.abs(min);
    return m >= 60 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}` : `${m} min`;
  };
  const href = (row: ArrivalRow) => {
    const a = row.blockers[0]?.action;
    if (!a) return `/app/stays/${row.stay.id}`;
    if (a.kind === "assign" || a.kind === "open_task" || a.kind === "review") return a.kind === "assign" ? "/app/missions" : `/app/missions/${a.taskId}`;
    if (a.kind === "open_incident") return "/app/incidents";
    if (a.kind === "open_service") return `/app/services/${a.serviceId}`;
    return `/app/stays/${row.stay.id}`;
  };
  const tone = { blocked: "bg-danger-soft text-danger", watch: "bg-warning-soft text-warning", preparing: "bg-accent-soft text-accent-text", ready: "bg-success-soft text-success" } as const;
  const todo = rows.filter((r) => r.state !== "ready");
  return (
    <div>
      <p className="mb-3 flex flex-wrap gap-2 text-[13px]" data-testid="arrival-counts">
        {(["blocked", "watch", "preparing", "ready"] as const).map((k) => (
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
            <div key={row.stay.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5" data-testid="arrival-row" data-state={row.state}>
              <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", tone[row.state])}>{t(`state.${row.state}`)}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-medium">
                  {row.stay.guestName || "—"} · {propName.get(row.stay.id)} · {row.minutesLeft >= 0 ? t("inTime", { time: dur(row.minutesLeft) }) : t("passed", { time: dur(row.minutesLeft) })}
                </span>
                {!b && row.pending.length > 0 && (
                  <span className="block text-[13px] text-muted" data-testid="arrival-pending">
                    {tc("pending", { steps: row.pending.map((p) => t(`step.${p}`)).join(", ") })}
                  </span>
                )}
                {b && (
                  <span className="block text-[13px] text-muted">
                    {b.kind.startsWith("step_") ? t(`blocker.${b.kind}`, { step: t(`step.${b.detail}`) }) : b.kind === "prep_blocking" ? t("blocker.prep_blocking", { title: String(b.detail ?? "") }) : t(`blocker.${b.kind}`)}
                    {row.blockers.length > 1 ? ` (+${row.blockers.length - 1})` : ""} · {who}
                  </span>
                )}
              </span>
              {b?.action.kind === "create_cleaning" ? (
                <CreateCleaningButton stayId={row.stay.id} label={t("action.create_cleaning")} />
              ) : b?.action.kind === "create_linen" ? (
                <CreateCleaningButton stayId={row.stay.id} label={t("action.create_linen")} kind="linen" />
              ) : b ? (
                <Link href={href(row)} className="inline-flex items-center gap-1 text-[14px] font-medium text-accent-text hover:underline" data-testid="arrival-action">
                  {t(`action.${b.action.kind}`)}
                  <ArrowRight className="size-4 rtl:-scale-x-100" />
                </Link>
              ) : null}
            </div>
          );
        })}
      </Card>
    </div>
  );
}
