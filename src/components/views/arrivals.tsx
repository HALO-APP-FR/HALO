"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, BedDouble, CircleCheck, ClipboardCheck, ConciergeBell, DoorOpen, Eye, KeyRound, Loader, Siren, Sparkles, UserRoundX, type LucideIcon } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { initialsOf, type ServiceRequest } from "@/lib/domain/types";
import { arrivalControl, arrivalCounts, type ArrivalRow, type ArrivalState, type Blocker, type BlockerKind } from "@/lib/engine/arrival-control";
import { formatDuration } from "@/lib/engine/learning";
import { addDaysToKey, formatLocalTime, localDateKey } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { arrivalsOfDay, byId, currentManager, taskDayKey } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/halo/avatar";
import { DayNav } from "@/components/halo/day-nav";
import { EmptyState } from "@/components/halo/empty-state";
import { GuestBadges } from "@/components/halo/guest-badges";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { TaskSheet } from "@/components/halo/task-sheet";
import { useLinenData } from "@/components/linen/use-linen";
import { ServiceSheet } from "@/components/services/service-sheet";
import { AlertSheet } from "@/components/views/alerts";
import { cn } from "@/lib/utils";

export const ARRIVAL_STATE_TONE: Record<ArrivalState, "danger" | "warning" | "accent" | "success"> = {
  blocked: "danger",
  watch: "warning",
  preparing: "accent",
  ready: "success",
};

const BLOCKER_ICON: Record<BlockerKind, LucideIcon> = {
  no_cleaning: Sparkles,
  cleaning_unassigned: UserRoundX,
  cleaning_infeasible: AlertTriangle,
  cleaning_late_start: Loader,
  awaiting_validation: ClipboardCheck,
  correction: Eye,
  urgent_incident: Siren,
  open_incident: Siren,
  linen_shortage: BedDouble,
  service_pending: ConciergeBell,
  guest_arrived_not_ready: DoorOpen,
};

/** Données du poste de pilotage pour un jour donné (fuseau de chaque logement). */
export function useArrivalRows(dayKey: string) {
  const reservations = useHalo((s) => s.reservations);
  const properties = useHalo((s) => s.properties);
  const tasks = useHalo((s) => s.tasks);
  const alerts = useHalo((s) => s.alerts);
  const services = useHalo((s) => s.services);
  const { forecast } = useLinenData(7);
  const props = byId(properties);
  const linenShortageDays = new Set(forecast.flatMap((r) => (r.shortageDay ? [r.shortageDay] : [])));
  return arrivalControl({
    stays: arrivalsOfDay(reservations, properties, dayKey),
    tasks,
    alerts,
    services,
    linenShortageDays,
    dayKeyOf: (t) => taskDayKey(t, props.get(t.propertyId)),
    now: new Date(),
  });
}

export function Arrivals() {
  return (
    <ReadyGate>
      <ArrivalsInner />
    </ReadyGate>
  );
}

type Filter = "todo" | "all";

function ArrivalsInner() {
  const t = useTranslations();
  const orgTz = useHalo((s) => s.org.timezone);
  const todayKey = localDateKey(new Date(), orgTz);
  const [dayKey, setDayKey] = useState(todayKey);
  const [filter, setFilter] = useState<Filter>("todo");
  const rows = useArrivalRows(dayKey);
  const counts = arrivalCounts(rows);
  const visible = filter === "todo" ? rows.filter((r) => r.state === "blocked" || r.state === "watch") : rows;

  const [taskId, setTaskId] = useState<string | null>(null);
  const [alertId, setAlertId] = useState<string | null>(null);
  const [serviceId, setServiceId] = useState<string | null>(null);
  const service = useHalo((s) => s.services.find((x) => x.id === serviceId) ?? null) as ServiceRequest | null;
  const router = useRouter();

  return (
    <>
      <PageHeader
        title={t("arrivals.title")}
        subtitle={t("arrivals.subtitle")}
        actions={<DayNav dayKey={dayKey} todayKey={todayKey} onChange={(d) => setDayKey(d === "today" ? todayKey : addDaysToKey(dayKey, d))} />}
      />

      {/* Compteurs : une arrivée = un état (pas de double compte) */}
      <section className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4" aria-label={t("arrivals.summary")}>
        {(["blocked", "watch", "preparing", "ready"] as const).map((s) => (
          <Card key={s} className="flex items-center justify-between gap-2 px-4 py-3" data-testid={`count-${s}`}>
            <span className="flex items-center gap-2 text-[14px] text-muted">
              <span className={cn("size-2.5 rounded-full", { blocked: "bg-danger", watch: "bg-warning", preparing: "bg-accent", ready: "bg-success" }[s])} />
              {t(`arrivals.state.${s}`)}
            </span>
            <span className="text-title-2 tabular">{counts[s]}</span>
          </Card>
        ))}
      </section>

      <Segmented
        label={t("arrivals.filter")}
        value={filter}
        onChange={setFilter}
        className="mb-4"
        options={[
          { value: "todo", label: `${t("arrivals.filterTodo")} · ${counts.blocked + counts.watch}` },
          { value: "all", label: `${t("arrivals.filterAll")} · ${rows.length}` },
        ]}
      />

      {visible.length === 0 ? (
        <Card>
          <EmptyState icon={rows.length ? CircleCheck : KeyRound} title={rows.length ? t("arrivals.nothingToDo") : t("arrivals.none")} className="py-10" />
        </Card>
      ) : (
        <ul className="space-y-3">
          {visible.map((row) => (
            <ArrivalCard
              key={row.stay.id}
              row={row}
              onAction={(b) => {
                const a = b.action;
                if (a.kind === "assign" || a.kind === "review" || a.kind === "open_task") setTaskId(a.taskId);
                else if (a.kind === "open_incident") setAlertId(a.alertId);
                else if (a.kind === "open_service") setServiceId(a.serviceId);
                else if (a.kind === "open_linen") router.push("/linen");
                else if (a.kind === "create_cleaning") setTaskId(useHalo.getState().createCleaningForStay(row.stay.id));
              }}
              onOpenCleaning={(id) => setTaskId(id)}
            />
          ))}
        </ul>
      )}
      <p className="mt-4 text-caption text-muted">{t("arrivals.footnote")}</p>

      <TaskSheet taskId={taskId} onClose={() => setTaskId(null)} />
      <AlertSheet alertId={alertId} onClose={() => setAlertId(null)} />
      <ServiceSheet service={service} onClose={() => setServiceId(null)} />
    </>
  );
}

function useCountdown() {
  const t = useTranslations();
  const locale = useLocale();
  return (minutes: number) =>
    minutes >= 0 ? t("arrivals.inTime", { time: formatDuration(minutes, locale) }) : t("arrivals.passed", { time: formatDuration(-minutes, locale) });
}

function ArrivalCard({ row, onAction, onOpenCleaning }: { row: ArrivalRow; onAction: (b: Blocker) => void; onOpenCleaning: (id: string) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const property = useHalo((s) => s.properties.find((p) => p.id === row.stay.propertyId));
  const members = useHalo((s) => s.members);
  const people = byId(members);
  const countdown = useCountdown();
  const tz = property?.timezone ?? "UTC";
  const manager = currentManager(members);
  const cleaner = row.cleaning?.assigneeId ? people.get(row.cleaning.assigneeId) : undefined;

  const responsibleLabel = (b: Blocker) =>
    b.responsible.kind === "member"
      ? people.get(b.responsible.id)?.name ?? "—"
      : b.responsible.kind === "manager"
        ? t("arrivals.responsibleManager", { name: manager?.name ?? "" })
        : t("arrivals.responsibleNobody");

  return (
    <li>
      <Card className="overflow-hidden" data-testid="arrival-row" data-state={row.state}>
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2 p-4 md:p-5">
          <div className="w-20 shrink-0">
            <div className="text-title-2 tabular">{formatLocalTime(new Date(row.stay.checkInAt), tz, locale)}</div>
            <div className={cn("text-caption tabular", row.minutesLeft < 0 ? "font-semibold text-danger" : "text-muted")}>{countdown(row.minutesLeft)}</div>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[16px] font-semibold">{property?.name}</span>
              <Badge tone={ARRIVAL_STATE_TONE[row.state]} data-testid="arrival-state">
                {t(`arrivals.state.${row.state}`)}
              </Badge>
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[14px] text-muted">
              <span>{row.stay.guestName ?? t(`source.${row.stay.source}`)}</span>
              <GuestBadges guests={row.stay.guestsCount} babies={row.stay.babies} pets={row.stay.pets} vip={row.stay.vip} size="sm" />
            </div>
            {row.cleaning && (
              <button type="button" onClick={() => onOpenCleaning(row.cleaning!.id)} className="mt-2 flex items-center gap-2 text-[14px] hover:underline">
                <Sparkles className="size-4 text-muted" />
                <span>
                  {t("arrivals.cleaning")} · {t(`taskStatus.${row.cleaning.status}`)}
                  {cleaner ? ` · ${cleaner.name}` : ""}
                </span>
                {cleaner && <Avatar initials={initialsOf(cleaner.name)} color={cleaner.color} size="sm" className="ring-0" />}
              </button>
            )}
          </div>
        </div>
        {row.blockers.length > 0 && (
          <ul className="divide-y divide-line border-t border-line">
            {row.blockers.map((b, i) => {
              const Icon = BLOCKER_ICON[b.kind];
              return (
                <li key={`${b.kind}-${i}`} className="flex flex-wrap items-center gap-3 px-4 py-3 md:px-5" data-testid="blocker" data-kind={b.kind}>
                  <span className={cn("grid size-9 shrink-0 place-items-center rounded-md", b.severity === "blocked" ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning")}>
                    <Icon className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <span className="min-w-0 flex-1 basis-[calc(100%-48px)] sm:basis-0">
                    <span className="block text-[15px] font-medium">
                      {t(`arrivals.blocker.${b.kind}`)}
                      {b.kind === "cleaning_infeasible" && b.detail ? ` : ${t(`feasibility.${b.detail}Title`)}` : ""}
                    </span>
                    <span className="block text-caption text-muted">{t("arrivals.responsible", { name: responsibleLabel(b) })}</span>
                  </span>
                  <Button size="sm" variant={b.severity === "blocked" ? "primary" : "secondary"} onClick={() => onAction(b)} className="ms-12 shrink-0 sm:ms-0">
                    {t(`arrivals.action.${b.action.kind}`)}
                    <ArrowRight className="rtl:-scale-x-100" />
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </li>
  );
}
