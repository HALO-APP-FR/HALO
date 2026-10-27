"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Check, ChevronLeft, ChevronRight, Clock, Monitor, Sun } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { initialsOf, type Property, type ServiceRequest, type Task } from "@/lib/domain/types";
import { actualMinutes, averageGap, formatDuration, workedMinutes } from "@/lib/engine/learning";
import { addDaysToKey, formatLocalTime, localDateKey, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { activeStaff, byId, taskAnchor, taskDayKey } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/halo/avatar";
import { StatusPill } from "@/components/halo/status-pill";
import { TASK_TYPE_META } from "@/components/halo/task-type";
import { VipBadge } from "@/components/halo/vip-badge";
import { SERVICE_STATUS_TONE, ServiceIcon } from "@/components/services/service-meta";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/halo/empty-state";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { ReadyGate } from "@/components/halo/ready-gate";
import { ReportSheet } from "@/components/halo/report-sheet";
import { TaskCard } from "@/components/halo/task-card";
import { ThemeSwitcher } from "@/components/halo/theme-switcher";

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supporté */
  }
}

/** Missions de l'agent connecté (mode démo : l'agent choisi dans le profil). */
function useMyTasks() {
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const me = useHalo((s) => s.members.find((m) => m.id === s.currentAgentId));
  const mine = tasks.filter((x) => x.assigneeId === me?.id && x.status !== "cancelled");
  return { me, mine, props: byId(properties) };
}

export function AgentToday() {
  return (
    <ReadyGate rows={2}>
      <AgentTodayInner />
    </ReadyGate>
  );
}

function AgentTodayInner() {
  const t = useTranslations();
  const locale = useLocale();
  const { me, mine, props } = useMyTasks();
  const router = useRouter();
  const { setTaskStatus } = useHalo.getState();
  const [reportFor, setReportFor] = useState<string | null>(null);
  const now = new Date();
  const todayTasks = mine
    .filter((x) => {
      const p = props.get(x.propertyId);
      return taskDayKey(x, p) === localDateKey(now, p?.timezone ?? "UTC") || x.status === "in_progress" || x.status === "to_redo";
    })
    .sort((a, b) => {
      // Reprises en tête, puis en cours, puis par heure limite
      const rank = (s: string) => (s === "to_redo" ? 0 : s === "in_progress" ? 1 : s === "done" || s === "validated" ? 3 : 2);
      return rank(a.status) - rank(b.status) || new Date(a.windowEnd).getTime() - new Date(b.windowEnd).getTime();
    });
  const remaining = todayTasks.filter((x) => x.status !== "done" && x.status !== "validated").length;
  const dateLabel = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long" }).format(now);

  return (
    <>
      <header className="pb-6">
        <p className="text-[15px] font-medium text-muted first-letter:uppercase">{dateLabel}</p>
        <h1 className="mt-1 text-display">{t("agentToday.greeting", { name: me?.name.split(" ")[0] ?? "" })}</h1>
        <p className="mt-1 text-[17px] text-muted">{t("agentToday.summary", { count: remaining })}</p>
      </header>
      {todayTasks.length === 0 ? (
        <EmptyState icon={Sun} title={t("agentToday.emptyTitle")} text={t("agentToday.emptyText")} />
      ) : (
        <ol className="space-y-4">
          {todayTasks.map((task) => {
            const property = props.get(task.propertyId);
            if (!property) return null;
            return (
              <li key={task.id}>
                {task.status === "to_redo" && task.notes && (
                  <p className="mb-2 rounded-lg bg-danger-soft px-4 py-3 text-[15px] text-danger">{task.notes}</p>
                )}
                <TaskCard
                  task={task}
                  property={property}
                  reference={now}
                  href={`/a/task/${task.id}`}
                  onStart={() => {
                    vibrate(10);
                    setTaskStatus(task.id, "in_progress");
                    router.push(`/a/task/${task.id}`);
                  }}
                  onFinish={() => {
                    vibrate(20);
                    setTaskStatus(task.id, "done");
                    toast(t("agentToday.doneToast"));
                  }}
                  onReport={() => setReportFor(task.id)}
                />
              </li>
            );
          })}
        </ol>
      )}
      <MyServicesToday />
      {(() => {
        const task = mine.find((x) => x.id === reportFor);
        const property = task && props.get(task.propertyId);
        return property ? (
          <ReportSheet
            open
            onOpenChange={(o) => !o && setReportFor(null)}
            property={property}
            source="agent"
            taskId={task.id}
            reservationId={task.reservationId}
            reporterName={me?.name}
          />
        ) : null;
      })()}
    </>
  );
}

/** Prestations confiées à la personne connectée (chef, chauffeur, concierge…) aujourd'hui et demain. */
function MyServicesToday() {
  const t = useTranslations();
  const locale = useLocale();
  const services = useHalo((s) => s.services);
  const properties = useHalo((s) => s.properties);
  const meId = useHalo((s) => s.currentAgentId);
  const props = byId(properties);
  const now = new Date();
  const mine = services
    .filter((x) => {
      if (x.assigneeId !== meId || x.status === "cancelled") return false;
      const p = props.get(x.propertyId);
      const key = localDateKey(new Date(x.startAt), p?.timezone ?? "UTC");
      const today = localDateKey(now, p?.timezone ?? "UTC");
      return key >= today && key <= addDaysToKey(today, 1);
    })
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
  if (mine.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="mb-3 text-title-3">{t("services.mine")}</h2>
      <ol className="space-y-3">
        {mine.map((x) => (
          <li key={x.id}>
            <ServiceAgentCard service={x} property={props.get(x.propertyId)} locale={locale} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function ServiceAgentCard({ service, property, locale }: { service: ServiceRequest; property?: Property; locale: string }) {
  const t = useTranslations();
  const tz = property?.timezone ?? "UTC";
  const when = `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric" }).format(new Date(service.startAt))} · ${formatLocalTime(new Date(service.startAt), tz, locale)}`;
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <ServiceIcon kind={service.kind} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[17px] font-semibold">{t(`serviceKind.${service.kind}`)}</span>
            <Badge tone={SERVICE_STATUS_TONE[service.status]}>{t(`serviceStatus.${service.status}`)}</Badge>
          </div>
          <p className="mt-0.5 text-[15px] font-semibold tabular first-letter:uppercase">{when}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[14px] text-muted">
            {property?.name}
            {service.guestName && <span>· {service.guestName}</span>}
            {service.people ? <span>· {t("task.guests", { count: service.people })}</span> : null}
            <VipBadge />
          </p>
          {service.details && <p className="mt-2 text-[15px]">{service.details}</p>}
        </div>
      </div>
      {service.status === "confirmed" && (
        <Button
          size="lg"
          variant="secondary"
          className="mt-4 w-full"
          onClick={() => {
            useHalo.getState().updateService(service.id, { status: "done" });
            toast(t("services.doneToast"));
          }}
        >
          <Check />
          {t("services.markDone")}
        </Button>
      )}
    </Card>
  );
}

/* ---------------- Calendrier de l'agent : 7 jours, semaine, mois ---------------- */
export function AgentUpcoming() {
  return (
    <ReadyGate rows={3}>
      <AgentUpcomingInner />
    </ReadyGate>
  );
}

const weekStartOf = (dayKey: string) => addDaysToKey(dayKey, -((new Date(`${dayKey}T12:00:00Z`).getUTCDay() + 6) % 7));
const dayTitle = (key: string, locale: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }) =>
  new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`));

function AgentUpcomingInner() {
  const t = useTranslations();
  const locale = useLocale();
  const { mine, props } = useMyTasks();
  const orgTz = useHalo((s) => s.org.timezone);
  const todayKey = localDateKey(new Date(), orgTz);
  const [view, setView] = useState<"list" | "week" | "month">("list");
  const [anchor, setAnchor] = useState(todayKey);
  const [picked, setPicked] = useState(todayKey);

  const byDay = new Map<string, Task[]>();
  for (const task of mine) {
    const key = taskDayKey(task, props.get(task.propertyId));
    byDay.set(key, [...(byDay.get(key) ?? []), task]);
  }
  for (const list of byDay.values()) list.sort((a, b) => taskAnchor(a).localeCompare(taskAnchor(b)));
  const minutesOf = (key: string) => (byDay.get(key) ?? []).reduce((n, x) => n + x.durationMin, 0);

  const shift = (dir: -1 | 1) => {
    if (view === "week") setAnchor(addDaysToKey(anchor, 7 * dir));
    else {
      const [y, m] = anchor.split("-").map(Number);
      setAnchor(new Date(Date.UTC(y, m - 1 + dir, 1)).toISOString().slice(0, 10));
    }
  };

  return (
    <>
      <h1 className="pb-4 text-display">{t("nav.calendar")}</h1>
      <Segmented
        label={t("planning.view")}
        value={view}
        onChange={(v) => {
          setView(v);
          setAnchor(todayKey);
          setPicked(todayKey);
        }}
        options={[
          { value: "list", label: t("agentCalendar.next7") },
          { value: "week", label: t("planning.week") },
          { value: "month", label: t("planning.month") },
        ]}
        className="mb-5 flex w-full [&>*]:flex-1"
      />

      {view === "list" ? (
        <NextDays byDay={byDay} todayKey={todayKey} props={props} />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <Button variant="ghost" size="icon" onClick={() => shift(-1)} aria-label={t("common.previous")}>
              <ChevronLeft className="rtl:-scale-x-100" />
            </Button>
            <span className="text-[17px] font-semibold first-letter:uppercase">
              {view === "week"
                ? t("planning.weekOf", { date: dayTitle(weekStartOf(anchor), locale, { day: "numeric", month: "long" }) })
                : dayTitle(`${anchor.slice(0, 7)}-15`, locale, { month: "long", year: "numeric" })}
            </span>
            <Button variant="ghost" size="icon" onClick={() => shift(1)} aria-label={t("common.next")}>
              <ChevronRight className="rtl:-scale-x-100" />
            </Button>
          </div>

          {view === "week" ? (
            <div className="space-y-3">
              {Array.from({ length: 7 }, (_, i) => addDaysToKey(weekStartOf(anchor), i)).map((key) => {
                const list = byDay.get(key) ?? [];
                return (
                  <Card key={key} className={cn("overflow-hidden", key === todayKey && "ring-2 ring-accent")}>
                    <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                      <span className={cn("text-[15px] font-semibold first-letter:uppercase", key < todayKey && "text-muted")}>{dayTitle(key, locale, { weekday: "long", day: "numeric" })}</span>
                      <span className="text-caption text-muted tabular">{list.length ? `${list.length} · ${formatDuration(minutesOf(key), locale)}` : t("agentCalendar.free")}</span>
                    </div>
                    {list.length > 0 && (
                      <ul className="divide-y divide-line">
                        {list.map((task) => (
                          <li key={task.id}>
                            <TaskRow task={task} property={props.get(task.propertyId)} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
            </div>
          ) : (
            <MonthView monthKey={anchor.slice(0, 7)} todayKey={todayKey} picked={picked} onPick={setPicked} byDay={byDay} minutesOf={minutesOf} props={props} />
          )}
        </>
      )}
    </>
  );
}

function NextDays({ byDay, todayKey, props }: { byDay: Map<string, Task[]>; todayKey: string; props: Map<string, Property> }) {
  const t = useTranslations();
  const locale = useLocale();
  const keys = Array.from({ length: 7 }, (_, i) => addDaysToKey(todayKey, i + 1)).filter((k) =>
    (byDay.get(k) ?? []).some((x) => x.status !== "done" && x.status !== "validated"),
  );
  if (keys.length === 0) return <EmptyState icon={CalendarClock} title={t("agentUpcoming.title")} text={t("agentUpcoming.emptyText")} />;
  return (
    <div className="space-y-8">
      {keys.map((key) => (
        <section key={key}>
          <h2 className="mb-3 text-title-3 first-letter:uppercase">{dayTitle(key, locale)}</h2>
          <ol className="space-y-3">
            {(byDay.get(key) ?? []).map((task) => {
              const property = props.get(task.propertyId);
              return property ? (
                <li key={task.id}>
                  <TaskCard task={task} property={property} reference={new Date(task.windowStart)} href={`/a/task/${task.id}`} />
                </li>
              ) : null;
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}

function TaskRow({ task, property }: { task: Task; property?: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  const tz = property?.timezone ?? "UTC";
  const real = actualMinutes(task);
  return (
    <Link href={`/a/task/${task.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors active:bg-surface-hover">
      <span className={cn("h-10 w-1 shrink-0 rounded-full", TASK_TYPE_META[task.type].bar)} aria-hidden />
      <span className="w-12 shrink-0 text-[15px] font-semibold tabular">{formatLocalTime(new Date(taskAnchor(task)), tz, locale)}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[15px] font-semibold">{property?.name}</span>
          {task.vip && <VipBadge />}
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-caption text-muted">
          {t(`taskType.${task.type}`)} · {formatDuration(real ?? task.durationMin, locale)} · <StatusPill status={task.status} />
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-faint rtl:-scale-x-100" />
    </Link>
  );
}

function MonthView({
  monthKey,
  todayKey,
  picked,
  onPick,
  byDay,
  minutesOf,
  props,
}: {
  monthKey: string;
  todayKey: string;
  picked: string;
  onPick: (key: string) => void;
  byDay: Map<string, Task[]>;
  minutesOf: (key: string) => number;
  props: Map<string, Property>;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [y, m] = monthKey.split("-").map(Number);
  const first = `${monthKey}-01`;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: count }, (_, i) => addDaysToKey(first, i));
  const weekdays = Array.from({ length: 7 }, (_, i) => dayTitle(addDaysToKey("2026-01-05", i), locale, { weekday: "narrow" }));
  const selected = picked.startsWith(monthKey) ? picked : first;
  const list = byDay.get(selected) ?? [];

  return (
    <>
      <Card className="p-3">
        <div className="grid grid-cols-7 text-center text-micro text-muted" aria-hidden>
          {weekdays.map((d, i) => (
            <span key={i} className="pb-2">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: lead }, (_, i) => (
            <span key={`l${i}`} />
          ))}
          {days.map((d) => {
            const n = (byDay.get(d) ?? []).length;
            const isSel = d === selected;
            return (
              <button
                key={d}
                type="button"
                onClick={() => onPick(d)}
                aria-pressed={isSel}
                aria-label={`${dayTitle(d, locale)} — ${t("tasks.count", { count: n })}`}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg text-[15px] tabular transition-colors",
                  isSel ? "bg-fg text-canvas" : d === todayKey ? "bg-accent-soft font-semibold text-accent-text" : "hover:bg-surface-hover",
                  d < todayKey && !isSel && "text-faint",
                )}
              >
                {Number(d.slice(8))}
                <span className="flex h-1.5 gap-0.5" aria-hidden>
                  {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                    <span key={i} className={cn("size-1.5 rounded-full", isSel ? "bg-canvas" : "bg-type-turnover")} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      </Card>
      <h2 className="mb-2 mt-5 flex items-baseline justify-between text-title-3">
        <span className="first-letter:uppercase">{dayTitle(selected, locale)}</span>
        {list.length > 0 && <span className="text-[14px] font-medium text-muted tabular">{formatDuration(minutesOf(selected), locale)}</span>}
      </h2>
      {list.length === 0 ? (
        <p className="py-6 text-center text-[15px] text-muted">{t("agentCalendar.free")}</p>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {list.map((task) => (
            <TaskRow key={task.id} task={task} property={props.get(task.propertyId)} />
          ))}
        </Card>
      )}
    </>
  );
}

/* ---------------- Heures travaillées (pointage) ---------------- */
function MyHours({ memberId }: { memberId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const orgTz = useHalo((s) => s.org.timezone);
  const props = byId(properties);
  const now = new Date();
  const todayKey = localDateKey(now, orgTz);
  const weekFrom = zonedTimeToUtc(weekStartOf(todayKey), "00:00", orgTz);
  const monthFrom = zonedTimeToUtc(`${todayKey.slice(0, 7)}-01`, "00:00", orgTz);
  const end = new Date(now.getTime() + 60_000);
  const week = workedMinutes(tasks, memberId, weekFrom, end);
  const month = workedMinutes(tasks, memberId, monthFrom, end);
  const gap = averageGap(tasks, memberId, new Date(now.getTime() - 30 * 86_400_000), end);
  const recent = tasks
    .filter((x) => x.assigneeId === memberId && x.completedAt && actualMinutes(x) !== null)
    .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
    .slice(0, 5);

  return (
    <>
      <h2 className="mb-3 mt-8 text-micro text-muted">{t("hours.title")}</h2>
      <div className="grid grid-cols-2 gap-2">
        <Card className="p-4">
          <p className="text-caption text-muted">{t("hours.week")}</p>
          <p className="mt-1 text-title-2 tabular">{formatDuration(week.minutes, locale)}</p>
          <p className="text-caption text-muted">{t("hours.missions", { count: week.count })}</p>
        </Card>
        <Card className="p-4">
          <p className="text-caption text-muted">{t("hours.month")}</p>
          <p className="mt-1 text-title-2 tabular">{formatDuration(month.minutes, locale)}</p>
          <p className="text-caption text-muted">{t("hours.missions", { count: month.count })}</p>
        </Card>
      </div>
      {gap !== null && (
        <p className="mt-2 flex items-center gap-1.5 text-[14px] text-muted">
          <Clock className="size-4" />
          {gap <= 0 ? t("hours.faster", { pct: Math.abs(gap) }) : t("hours.slower", { pct: gap })}
        </p>
      )}
      {recent.length > 0 && (
        <Card className="mt-3 divide-y divide-line">
          {recent.map((x) => {
            const p = props.get(x.propertyId);
            const real = (actualMinutes(x) ?? 0) + (x.previousWorkMin ?? 0);
            return (
              <div key={x.id} className="flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">{p?.name}</span>
                  <span className="block text-caption text-muted first-letter:uppercase">
                    {new Intl.DateTimeFormat(locale, { timeZone: p?.timezone ?? orgTz, weekday: "short", day: "numeric", month: "short" }).format(new Date(x.completedAt!))}
                  </span>
                </span>
                <span className="text-end">
                  <span className="block text-[15px] font-semibold tabular">{formatDuration(real, locale)}</span>
                  <span className="block text-caption text-muted tabular">{t("mission.plannedTime", { time: formatDuration(x.durationMin, locale) })}</span>
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}

export function AgentProfile() {
  return (
    <ReadyGate rows={2}>
      <AgentProfileInner />
    </ReadyGate>
  );
}

function AgentProfileInner() {
  const t = useTranslations();
  const members = useHalo((s) => s.members);
  const org = useHalo((s) => s.org);
  const currentId = useHalo((s) => s.currentAgentId);
  const { setCurrentAgent } = useHalo.getState();
  const me = members.find((m) => m.id === currentId);
  const agents = activeStaff(members);

  return (
    <>
      <h1 className="pb-6 text-display">{t("profile.title")}</h1>
      {me && (
        <Card className="flex items-center gap-4 p-5">
          <Avatar initials={initialsOf(me.name)} color={me.color} size="lg" />
          <div>
            <div className="text-title-3">{me.name}</div>
            <div className="text-[15px] text-muted">
              {me.position ? `${t(`position.${me.position}`)} · ` : ""}
              {org.name}
            </div>
          </div>
        </Card>
      )}
      {me && <MyHours memberId={me.id} />}

      <h2 className="mb-3 mt-8 text-micro text-muted">{t("profile.preferences")}</h2>
      <Card className="divide-y divide-line px-4">
        <div className="py-1">
          <LocaleSwitcher variant="row" />
        </div>
        <div className="py-4">
          <div className="mb-3 text-[17px]">{t("theme.label")}</div>
          <ThemeSwitcher className="flex w-full" />
        </div>
      </Card>

      <h2 className="mb-3 mt-8 text-micro text-muted">{t("profile.demo")}</h2>
      <Card className="p-4">
        <label htmlFor="as" className="mb-2 block text-[15px]">
          {t("profile.viewAs")}
        </label>
        <Select id="as" value={currentId} onChange={(e) => setCurrentAgent(e.target.value)} className="h-12 text-[16px]">
          {agents.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
      </Card>

      <Link href="/today" className="mt-8 flex h-11 items-center justify-center gap-2 text-[15px] font-medium text-accent-text">
        <Monitor className="size-4" />
        {t("nav.switchToManager")}
      </Link>
    </>
  );
}
