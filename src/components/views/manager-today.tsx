"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, ArrowRight, CalendarPlus, CircleCheck, DoorClosed, KeyRound, Siren, Sparkles, UserRoundX, ConciergeBell, BedDouble } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import { Link } from "@/i18n/navigation";
import { addDaysToKey, localDateKey } from "@/lib/engine/time";
import { useLinenData } from "@/components/linen/use-linen";
import { infeasibility } from "@/lib/engine/conflicts";
import { useHalo } from "@/lib/store/halo-store";
import { isPendingService } from "@/components/services/service-meta";
import { activeAgents, arrivalsOfDay, departuresOfDay, tasksOfDay } from "@/lib/store/selectors";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DayNav } from "@/components/halo/day-nav";
import { DayTable } from "@/components/halo/day-table";
import { EmptyState } from "@/components/halo/empty-state";
import { KpiCard } from "@/components/halo/kpi-card";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { StaysSheet } from "@/components/halo/stays-sheet";
import { TaskSheet } from "@/components/halo/task-sheet";

export function ManagerToday() {
  return (
    <ReadyGate>
      <ManagerTodayInner />
    </ReadyGate>
  );
}

function ManagerTodayInner() {
  const t = useTranslations();
  const locale = useLocale();
  const org = useHalo((s) => s.org);
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const reservations = useHalo((s) => s.reservations);
  const members = useHalo((s) => s.members);
  const alerts = useHalo((s) => s.alerts);
  const router = useRouter();
  const [staysOpen, setStaysOpen] = useState<"arrivals" | "departures" | null>(null);

  const todayKey = localDateKey(new Date(), org.timezone);
  const [dayKey, setDayKey] = useState(todayKey);
  const [openTask, setOpenTask] = useState<string | null>(null);

  const dayTasks = tasksOfDay(tasks, properties, dayKey);
  const cleanings = dayTasks.filter((x) => x.type === "turnover");
  const unassigned = dayTasks.filter((x) => x.status === "unassigned");
  const toValidate = tasks.filter((x) => x.status === "done");
  const urgent = dayTasks.filter((x) => x.status === "unassigned" && x.priority === "urgent");
  const arrivals = arrivalsOfDay(reservations, properties, dayKey);
  const departures = departuresOfDay(reservations, properties, dayKey);
  const services = useHalo((s) => s.services);
  const { forecast } = useLinenData(7);
  // Missions en retard ou qui ne tiennent pas dans leur fenêtre (à décider par un responsable)
  const nowDate = new Date();
  const blocked = tasks
    .filter((x) => infeasibility(x, nowDate))
    .sort((a, b) => a.windowEnd.localeCompare(b.windowEnd));
  const linenShortages = forecast.filter((r) => r.shortageDay);
  const requestedServices = services.filter(isPendingService);
  const openAlerts = alerts.filter((a) => a.status !== "resolved");
  const urgentAlerts = openAlerts.filter((a) => a.urgent);
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${dayKey}T12:00:00Z`),
  );

  const actions = [
    openAlerts.length > 0 && {
      key: "alerts",
      icon: Siren,
      tone: urgentAlerts.length ? "text-danger bg-danger-soft" : "text-warning bg-warning-soft",
      label: urgentAlerts.length
        ? t("managerToday.alertsUrgent", { count: openAlerts.length, urgent: urgentAlerts.length })
        : t("managerToday.alertsOpen", { count: openAlerts.length }),
      cta: t("managerToday.view"),
      onClick: () => router.push("/alerts"),
      primary: urgentAlerts.length > 0,
    },
    blocked.length > 0 && {
      key: "blocked",
      icon: AlertTriangle,
      tone: "text-danger bg-danger-soft",
      label: t("managerToday.blocked", { count: blocked.length }),
      cta: t("managerToday.view"),
      onClick: () => setOpenTask(blocked[0].id),
      primary: true,
    },
    linenShortages.length > 0 && {
      key: "linen",
      icon: BedDouble,
      tone: "text-danger bg-danger-soft",
      label: t("managerToday.linenShortage", { count: linenShortages.length }),
      cta: t("managerToday.view"),
      onClick: () => router.push("/linen"),
      primary: false,
    },
    requestedServices.length > 0 && {
      key: "services",
      icon: ConciergeBell,
      tone: "text-vip bg-vip-soft",
      label: t("managerToday.servicesRequested", { count: requestedServices.length }),
      cta: t("managerToday.view"),
      onClick: () => router.push("/services?filter=todo"),
      primary: false,
    },
    unassigned.length > 0 && {
      key: "unassigned",
      icon: UserRoundX,
      tone: "text-danger bg-danger-soft",
      label: t("managerToday.unassignedCount", { count: unassigned.length }),
      cta: t("managerToday.assign"),
      onClick: () => setOpenTask((urgent[0] ?? unassigned[0]).id),
      primary: true,
    },
    toValidate.length > 0 && {
      key: "validate",
      icon: CircleCheck,
      tone: "text-warning bg-warning-soft",
      label: t("managerToday.toValidateCount", { count: toValidate.length }),
      cta: t("managerToday.review"),
      onClick: () => setOpenTask(toValidate[0].id),
      primary: false,
    },
  ].filter(Boolean) as Array<{ key: string; icon: typeof UserRoundX; tone: string; label: string; cta: string; onClick: () => void; primary: boolean }>;

  return (
    <>
      <PageHeader
        title={dayKey === todayKey ? t("managerToday.title") : dateLabel}
        subtitle={dayKey === todayKey ? dateLabel : undefined}
        actions={
          <DayNav
            dayKey={dayKey}
            todayKey={todayKey}
            onChange={(d) => setDayKey(d === "today" ? todayKey : addDaysToKey(dayKey, d))}
          />
        }
      />

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-4">
        <KpiCard label={t("managerToday.kpiArrivals")} value={arrivals.length} icon={KeyRound} onClick={() => setStaysOpen("arrivals")} />
        <KpiCard label={t("managerToday.kpiDepartures")} value={departures.length} icon={DoorClosed} onClick={() => setStaysOpen("departures")} />
        <KpiCard
          label={t("managerToday.kpiCleanings")}
          value={cleanings.length}
          icon={Sparkles}
          href={`/tasks?period=${dayKey === todayKey ? "today" : "all"}&type=turnover&status=all&day=${dayKey}`}
        />
        <KpiCard
          label={t("managerToday.kpiUnassigned")}
          shortLabel={t("managerToday.kpiUnassignedShort")}
          value={unassigned.length}
          icon={AlertTriangle}
          tone="danger"
          href={`/planning?day=${dayKey}`}
        />
      </section>

      {actions.length > 0 && (
        <Card className="mt-4 md:mt-6">
          <CardHeader>
            <CardTitle>{t("managerToday.toHandle")}</CardTitle>
          </CardHeader>
          <ul className="mt-2 divide-y divide-line">
            {actions.map(({ key, icon: Icon, tone, label, cta, onClick, primary }) => (
              <li key={key} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <span className="flex min-w-0 items-center gap-3">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-md ${tone}`}>
                    <Icon className="size-[18px]" strokeWidth={1.9} />
                  </span>
                  <span className="text-[15px] font-medium">{label}</span>
                </span>
                <Button size="sm" variant={primary ? "primary" : "secondary"} onClick={onClick}>
                  {cta}
                  <ArrowRight className="rtl:-scale-x-100" />
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-4 md:mt-6">
        <CardHeader>
          <CardTitle>{t("managerToday.timeline")}</CardTitle>
          {dayTasks.length > 0 && (
            <Button asChild variant="ghost" size="sm" className="text-muted">
              <Link href="/planning">
                {t("nav.planning")}
                <ArrowRight className="rtl:-scale-x-100" />
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-2">
          {dayTasks.length === 0 ? (
            <EmptyState
              icon={CalendarPlus}
              title={t("managerToday.emptyTitle")}
              text={properties.length === 0 ? t("managerToday.emptyNoProperty") : t("managerToday.emptyText")}
              action={
                <Button asChild variant="secondary">
                  <Link href="/properties">{t("nav.properties")}</Link>
                </Button>
              }
              className="py-8"
            />
          ) : (
            <>
              <DayTable
                tasks={dayTasks}
                properties={properties}
                agents={activeAgents(members)}
                orgTimezone={org.timezone}
                onOpen={setOpenTask}
              />
              <p className="mt-4 text-caption text-muted">{t("common.localTimeNote")}</p>
            </>
          )}
        </CardContent>
      </Card>

      <TaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      <StaysSheet
        kind={staysOpen}
        stays={staysOpen === "departures" ? departures : arrivals}
        properties={properties}
        title={staysOpen === "departures" ? t("managerToday.kpiDepartures") : t("managerToday.kpiArrivals")}
        onClose={() => setStaysOpen(null)}
      />
    </>
  );
}
