import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/halo/page-header";
import { AssignSelect } from "@/components/connected/mission-controls";
import { TaskStepButtons } from "@/components/connected/task-step";
import { MissionTiming } from "@/components/connected/mission-timing";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { isoFromNow, nowDate } from "@/lib/connected/time";
import { infeasibility } from "@/lib/engine/conflicts";
import { toTask, type Row } from "@/lib/connected/mappers";
import { loadPlanning } from "@/lib/connected/planning";
import { blockingAbsences } from "@/lib/engine/availability";
import { durationText, periodText, zoneLabel } from "@/lib/connected/format";
import { ChevronRight, ListChecks, MapPin, Timer, TriangleAlert } from "lucide-react";
import { StatusPill } from "@/components/halo/status-pill";
import { TaskTypeIcon, TASK_TYPE_META } from "@/components/halo/task-type";
import { EmptyState } from "@/components/halo/empty-state";
import { Avatar } from "@/components/connected/avatar";
import { MissionFilters } from "@/components/connected/mission-filters";
import { PERIODS, STATUS_FILTERS, TYPE_FILTERS, periodBounds, statusesOf, typesOf } from "@/lib/connected/mission-filters";
import type { TaskStatus, TaskType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";
import { overrunDueAt } from "@/lib/engine/overrun";

export default async function MissionsPage({ params, searchParams }: PageProps<"/[locale]/app/missions">) {
  const { locale } = await params;
  const sp = await searchParams;
  const onlyToValidate = sp.status === "done";
  setRequestLocale(locale);
  const t = await getTranslations("connected.missions");
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const f = await getFormatter();
  const { supabase, org, user } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  const manager = isManagerRole(org!.role);
  // Filtres (responsable) : période, statut, type, logement, recherche — appliqués par la requête
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const period = (PERIODS as readonly string[]).includes(one(sp.period)) ? one(sp.period) : "upcoming";
  const statusF = onlyToValidate ? "done" : (STATUS_FILTERS as readonly string[]).includes(one(sp.status)) ? one(sp.status) : "todo";
  const typeF = TYPE_FILTERS.includes(one(sp.type)) ? one(sp.type) : "";
  const propertyF = /^[0-9a-f-]{36}$/.test(one(sp.property)) ? one(sp.property) : "";
  const search = one(sp.q).trim().slice(0, 80);
  const now0 = nowDate();
  const since = isoFromNow(-86_400_000);
  // Journée et semaine dans le fuseau de l'organisation (jamais celui du serveur)
  const { data: tzRow } = await supabase.from("organizations").select("timezone").eq("id", org!.id).single();
  const orgTz = (tzRow?.timezone as string | undefined) ?? "Europe/Paris";
  let q = supabase
    .from("tasks")
    .select("*, properties(name, address_line, city, timezone), next:reservations!tasks_organization_id_next_reservation_id_fkey(check_in_at)")
    .eq("organization_id", org!.id)
    .order("window_start", { ascending: period !== "past" })
    .limit(200);
  // Agent : uniquement les siennes (la base l'impose déjà ; ce filtre évite d'afficher des missions passées d'autres)
  if (!manager) q = q.eq("assignee_id", user!.id).neq("status", "cancelled").gte("window_end", since);
  else {
    // Même règle que les compteurs (accueil, linge) : statuts, types et période partagés
    const st = statusesOf(statusF);
    q = st ? q.in("status", st) : q.neq("status", "cancelled");
    // « À valider » : toutes les missions terminées, quelle que soit la date
    if (!onlyToValidate) {
      const b = periodBounds(period, now0, orgTz);
      if (b.to) q = q.lt("window_start", b.to.toISOString());
      if (b.from) q = q.gt("window_end", b.from.toISOString());
      if (b.endedBefore) q = q.lt("window_end", b.endedBefore.toISOString());
    }
    const ty = typesOf(typeF);
    if (ty.length) q = q.in("type", ty);
    if (propertyF) q = q.eq("property_id", propertyF);
  }
  const now = nowDate();
  const [{ data: rawTasks, error }, { data: members }, planning, { data: propList }] = await Promise.all([
    q,
    manager ? supabase.from("memberships").select("user_id, role, profiles(full_name)").eq("organization_id", org!.id).eq("is_active", true) : Promise.resolve({ data: [] as never[] }),
    manager ? loadPlanning(supabase, org!.id, now) : Promise.resolve(null),
    manager ? supabase.from("properties").select("id, name").eq("organization_id", org!.id).order("name") : Promise.resolve({ data: [] as never[] }),
  ]);
  const tc = await getTranslations("connected.schedule");
  // Personnes absentes sur le créneau de chaque mission (même règle que la base)
  const ta = await getTranslations("connected.absences");
  // Personnes absentes sur le créneau réel de chaque mission (même règle que la base), avec le motif
  const away = (k: { window_start: string; window_end: string; duration_min: number; scheduled_start: string | null }) => {
    const out: Record<string, string> = {};
    for (const m of planning?.members ?? []) {
      const b = blockingAbsences(m, { windowStart: k.window_start, windowEnd: k.window_end, durationMin: k.duration_min, scheduledStart: k.scheduled_start }, planning!.absences);
      if (b.length) out[m.id] = `${ta(`kinds.${b[0].kind}`)} ${periodText(f, b[0].startsAt, b[0].endsAt)}`;
    }
    return out;
  };
  const tm = await getTranslations("connected.missionList");
  // Recherche : logement, type, titre ou personne affectée (en mémoire, sur la sélection déjà filtrée)
  const tasks = (rawTasks ?? []).filter((k) => {
    if (!search) return true;
    const pn = ((Array.isArray(k.properties) ? k.properties[0] : k.properties) as { name: string } | null)?.name ?? "";
    const who = (members ?? []).find((m: { user_id: string }) => m.user_id === k.assignee_id) as { profiles: unknown } | undefined;
    const wn = ((Array.isArray(who?.profiles) ? who?.profiles[0] : who?.profiles) as { full_name: string } | null)?.full_name ?? "";
    return [pn, tt(k.type), k.title ?? "", wn].join(" ").toLocaleLowerCase(locale).includes(search.toLocaleLowerCase(locale));
  });
  const nextArrival = (k: { next?: unknown }) => ((Array.isArray(k.next) ? k.next[0] : k.next) as { check_in_at: string } | null)?.check_in_at ?? null;
  const people = (members ?? []).map((m: { user_id: string; profiles: unknown }) => {
    const p = (Array.isArray(m.profiles) ? m.profiles[0] : m.profiles) as { full_name: string } | null;
    return { id: m.user_id, name: p?.full_name || t("noName") };
  });
  return (
    <>
      <PageHeader title={onlyToValidate ? t("toValidateTitle") : manager ? t("title") : t("mineTitle")} subtitle={onlyToValidate ? t("toValidateSubtitle") : manager ? tm("count", { count: tasks.length }) : t("mineSubtitle")} />
      {onlyToValidate && (
        <Link href="/app/missions" className="-mt-2 mb-4 inline-block text-[14px] text-accent-text hover:underline" data-testid="missions-all">
          {t("showAll")}
        </Link>
      )}
      {error && <p role="alert" className="mb-4 text-danger">{t("loadError")}</p>}
      {planning && planning.schedule.length > 0 && (
        // Ménages impossibles : signalés au lieu d'être créés avec un créneau intenable
        <Card className="mb-4 border-danger p-5" data-testid="schedule-conflicts">
          <h2 className="flex items-center gap-2 text-[17px] font-semibold text-danger">
            <TriangleAlert className="size-5" />
            {tc("title", { count: planning.schedule.length })}
          </h2>
          <p className="mt-1 text-[14px] text-muted">{tc("text")}</p>
          <ul className="mt-3 divide-y divide-line">
            {planning.schedule.map((c) => (
              <li key={`${c.reservationId}-${c.kind}`} className="flex flex-wrap items-center gap-2 py-2.5 text-[14px]" data-testid="schedule-conflict">
                <span className="flex-1">
                  <span className="font-medium">{c.propertyName}</span> · {tc(`kind.${c.kind}`, { available: durationText(c.availableMin ?? 0), needed: durationText(c.neededMin ?? 0) })}
                </span>
                <Link href={`/app/stays/${c.nextReservationId ?? c.reservationId}`} className="text-accent-text hover:underline">
                  {tc("open")}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {manager && !onlyToValidate && (
        <MissionFilters properties={(propList ?? []) as { id: string; name: string }[]} period={period} status={statusF} type={typeF} property={propertyF} q={search} />
      )}
      {tasks.length === 0 ? (
        <Card>
          {manager && (statusF !== "todo" || typeF || propertyF || search || period !== "upcoming") ? (
            // Écran ouvert depuis un compteur (accueil, linge) : on rappelle exactement ce qui a été cherché
            <EmptyState
              icon={ListChecks}
              title={tm("emptyFilteredTitle")}
              text={tm("emptyFiltered", {
                period: tm(`periods.${period}`),
                status: statusF === "todo" ? tm("todo") : statusF === "all" ? tm("allStatuses") : statusF === "done" ? tm("toValidate") : tts(statusF),
                type: typeF ? (typeF === "linen" ? tm("linenGroup") : tt(typeF)) : tm("allTypes"),
              })}
              data-testid="missions-empty-filtered"
            />
          ) : (
            <EmptyState icon={ListChecks} title={manager ? t("empty") : t("mineEmpty")} text={manager ? tm("emptyText") : tm("mineEmptyText")} />
          )}
        </Card>
      ) : manager ? (
        <Card className="overflow-hidden">
          {/* En-têtes (ordinateur) */}
          <div className="hidden grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_20px] gap-4 border-b border-line px-5 py-3 text-micro text-muted md:grid" aria-hidden>
            <span>{tm("colMission")}</span>
            <span>{tm("colWhen")}</span>
            <span>{tm("colAgent")}</span>
            <span>{tm("colStatus")}</span>
            <span />
          </div>
          <ul className="divide-y divide-line">
            {tasks.map((k) => {
              const p = (Array.isArray(k.properties) ? k.properties[0] : k.properties) as { name: string; address_line: string | null; city: string | null; timezone: string | null } | null;
              const tz = p?.timezone ?? undefined;
              const zone = zoneLabel(p?.timezone, new Date(k.window_start));
              const anchor = k.scheduled_start ?? k.window_start;
              const day = f.dateTime(new Date(anchor), { weekday: "short", day: "numeric", month: "short", ...(tz ? { timeZone: tz } : {}) });
              const hm = (x: string | number) => f.dateTime(new Date(x), { hour: "2-digit", minute: "2-digit", ...(tz ? { timeZone: tz } : {}) });
              const sameDay = (a: string, b: string) => f.dateTime(new Date(a), { dateStyle: "short", ...(tz ? { timeZone: tz } : {}) }) === f.dateTime(new Date(b), { dateStyle: "short", ...(tz ? { timeZone: tz } : {}) });
              const deadline = sameDay(k.window_end, anchor) ? hm(k.window_end) : `${f.dateTime(new Date(k.window_end), { weekday: "short", ...(tz ? { timeZone: tz } : {}) })} ${hm(k.window_end)}`;
              const slot = k.scheduled_start ? `${hm(k.scheduled_start)} → ${hm(Date.parse(k.scheduled_start) + k.duration_min * 60_000)}` : tm("before", { time: deadline });
              const awayNow = away(k);
              const assignee = people.find((x) => x.id === k.assignee_id);
              // Alertes courtes, uniquement sur des règles connues
              const alerts: { key: string; tone: "danger" | "warning" }[] = [];
              if (["unassigned", "assigned", "to_redo"].includes(k.status) && infeasibility(toTask(k as Row), now)) alerts.push({ key: "late", tone: "danger" });
              if (k.assignee_id && awayNow[k.assignee_id] && ["assigned", "to_redo"].includes(k.status)) alerts.push({ key: "away", tone: "danger" });
              if (k.status === "in_progress" && k.started_at && k.duration_min > 0 && now.getTime() > Date.parse(k.started_at) + k.duration_min * 60_000) alerts.push({ key: "overrun", tone: "warning" });
              if (k.status === "unassigned" && Date.parse(k.window_start) - now.getTime() < 24 * 3_600_000) alerts.push({ key: "assignSoon", tone: "danger" });
              // Fin régularisée par un responsable (migration 23) : jamais confondue avec une fin normale
              if ((k as { regularized_at?: string | null }).regularized_at) {
                alerts.push({ key: "regularized", tone: "warning" });
                if (((k as { regularized_missing?: string[] | null }).regularized_missing ?? []).length > 0) alerts.push({ key: "missingProofs", tone: "danger" });
              }
              const editable = ["unassigned", "assigned"].includes(k.status);
              return (
                <li
                  key={k.id}
                  className={cn("relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3.5 hover:bg-surface-hover md:grid-cols-[minmax(0,2.2fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_minmax(0,1fr)_20px] md:gap-4 md:px-5", k.status === "done" && "bg-warning-soft/30")}
                  data-testid="mission-row"
                  data-status={k.status}
                >
                  {/* Mission : type + logement mis en avant */}
                  <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-3 md:col-start-auto md:row-start-auto">
                    <TaskTypeIcon type={k.type as TaskType} size="md" />
                    <div className="min-w-0">
                      <Link href={`/app/missions/${k.id}`} className="block truncate text-[15px] font-semibold after:absolute after:inset-0 after:content-['']" data-testid="mission-link">
                        {p?.name}
                      </Link>
                      <p className={cn("truncate text-[13px]", TASK_TYPE_META[k.type as TaskType]?.text ?? "text-muted")}>
                        {tt(k.type)}
                        {k.title && (
                          <span className="text-muted" data-testid="mission-title">
                            {" · "}
                            {k.title}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                  {/* Quand */}
                  <div className="col-start-1 row-start-2 min-w-0 ps-12 text-[13px] md:col-start-auto md:row-start-auto md:ps-0">
                    <p className="truncate font-medium first-letter:uppercase md:text-[14px]">
                      {day}
                      <span className="font-normal text-muted md:hidden"> · {slot}</span>
                    </p>
                    <p className="hidden truncate text-muted md:block">{slot}</p>
                    {zone && <p className="truncate text-[12px] text-faint" data-testid="mission-zone">{t("localTime", { zone })}</p>}
                  </div>
                  {/* Personne affectée : avatar ; sélecteur discret seulement si l'affectation est modifiable */}
                  <div className="relative z-10 col-start-2 row-span-3 row-start-1 flex items-center justify-end md:col-start-auto md:row-span-1 md:row-start-auto md:justify-start">
                    {editable ? (
                      <AssignSelect
                        compact
                        taskId={k.id}
                        current={k.assignee_id}
                        members={people}
                        outOfWindow={Boolean(infeasibility(toTask(k as Row), now))}
                        durationMin={k.duration_min}
                        arrival={nextArrival(k) ? f.dateTime(new Date(nextArrival(k)!), { dateStyle: "medium", timeStyle: "short" }) : null}
                        unavailable={Object.keys(awayNow)}
                        reasons={awayNow}
                        timeZone={tz}
                      />
                    ) : assignee ? (
                      <span className="flex min-w-0 items-center gap-2 text-[14px]" data-testid="mission-assignee">
                        <Avatar name={assignee.name} id={assignee.id} size="sm" />
                        <span className="hidden truncate md:inline">{assignee.name}</span>
                      </span>
                    ) : (
                      <span className="text-[13px] text-danger">{t("unassigned")}</span>
                    )}
                  </div>
                  {/* Statut + alerte courte */}
                  <div className="col-start-1 row-start-3 flex flex-wrap items-center gap-x-2 gap-y-1 ps-12 md:col-start-auto md:row-start-auto md:ps-0">
                    <StatusPill status={k.status as TaskStatus} />
                    {alerts.map((a) => (
                      <span key={a.key} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", a.tone === "danger" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")} data-testid={`mission-alert-${a.key}`}>
                        {a.key === "overrun" ? <Timer className="size-3" /> : <TriangleAlert className="size-3" />}
                        {tm(`alert.${a.key}`)}
                      </span>
                    ))}
                  </div>
                  <ChevronRight className="hidden size-4 text-faint md:block rtl:-scale-x-100" aria-hidden />
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        // Agent : cartes terrain — logement, horaire, adresse, consignes, action
        <ul className="space-y-3">
          {tasks.map((k) => {
            const p = (Array.isArray(k.properties) ? k.properties[0] : k.properties) as { name: string; address_line: string | null; city: string | null; timezone: string | null } | null;
            const meta = TASK_TYPE_META[k.type as TaskType];
            const zone = zoneLabel(p?.timezone, new Date(k.window_start));
            const overrun = k.status === "in_progress" && k.started_at && (overrunDueAt(k.started_at, k.duration_min, (k.overrun_ack_at as string | null) ?? null) ?? Infinity) <= now.getTime();
            return (
              <li key={k.id} className={cn("relative overflow-hidden rounded-xl border border-line bg-surface shadow-card", ["done", "validated"].includes(k.status) && "opacity-70")} data-testid="mission-row" data-status={k.status}>
                <span className={cn("absolute inset-y-0 start-0 w-1", meta?.bar)} aria-hidden />
                <div className="p-4 ps-5 md:p-5 md:ps-6">
                  <div className="flex items-center justify-between gap-3">
                    <span className={cn("flex items-center gap-2 text-[14px] font-semibold", meta?.text)}>
                      <TaskTypeIcon type={k.type as TaskType} size="sm" />
                      {tt(k.type)}
                    </span>
                    <StatusPill status={k.status as TaskStatus} />
                  </div>
                  <Link href={`/app/missions/${k.id}`} className="mt-3 flex items-center justify-between gap-2 after:absolute after:inset-0 after:content-['']" data-testid="mission-link">
                    <span className="min-w-0">
                      <span className="block truncate text-[20px] font-semibold leading-7 tracking-[-0.01em]">{p?.name}</span>
                      {k.title && <span className="block truncate text-[15px] font-medium text-accent-text" data-testid="mission-title">{k.title}</span>}
                    </span>
                    <ChevronRight className="size-5 shrink-0 text-faint rtl:-scale-x-100" aria-hidden />
                  </Link>
                  {p?.address_line && (
                    <p className="mt-1 flex items-center gap-1.5 truncate text-[14px] text-muted">
                      <MapPin className="size-4 shrink-0" />
                      {[p.address_line, p.city].filter(Boolean).join(", ")}
                    </p>
                  )}
                  <div className="mt-3 text-[15px]">
                    <MissionTiming task={k} timeZone={p?.timezone ?? undefined} compact />
                    {zone && <span className="block text-[12px] text-faint" data-testid="mission-zone">{t("localTime", { zone })}</span>}
                  </div>
                  {k.notes && (
                    <p className="mt-2 line-clamp-2 rounded-md bg-subtle px-3 py-2 text-[14px] dark:bg-surface-hover" data-testid="mission-notes-preview">
                      {k.notes}
                    </p>
                  )}
                  <div className="relative z-10 mt-3 flex flex-wrap items-center justify-end gap-2">
                    {overrun && (
                      // Rappel dans l'application (pas de notification push) : l'agent répond depuis la fiche
                      <Link href={`/app/missions/${k.id}`} className="me-auto inline-flex items-center gap-1.5 rounded-full bg-warning-soft px-3 py-1.5 text-[13px] font-medium" data-testid="mission-overrun">
                        <Timer className="size-4" />
                        {t("overrunReached")}
                      </Link>
                    )}
                    <TaskStepButtons taskId={k.id} status={k.status} timeZone={p?.timezone ?? undefined} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
