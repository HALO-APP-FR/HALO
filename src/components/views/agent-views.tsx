"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarClock, Monitor, Sun } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { initialsOf } from "@/lib/domain/types";
import { addDaysToKey, localDateKey } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { activeAgents, byId, taskAnchor, taskDayKey } from "@/lib/store/selectors";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Avatar } from "@/components/halo/avatar";
import { EmptyState } from "@/components/halo/empty-state";
import { LocaleSwitcher } from "@/components/halo/locale-switcher";
import { ReadyGate } from "@/components/halo/ready-gate";
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
  const { setTaskStatus } = useHalo.getState();
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
                  onStart={() => {
                    vibrate(10);
                    setTaskStatus(task.id, "in_progress");
                  }}
                  onFinish={() => {
                    vibrate(20);
                    setTaskStatus(task.id, "done");
                    toast(t("agentToday.doneToast"));
                  }}
                />
              </li>
            );
          })}
        </ol>
      )}
    </>
  );
}

export function AgentUpcoming() {
  return (
    <ReadyGate rows={3}>
      <AgentUpcomingInner />
    </ReadyGate>
  );
}

function AgentUpcomingInner() {
  const t = useTranslations();
  const locale = useLocale();
  const { mine, props } = useMyTasks();
  const orgTz = useHalo((s) => s.org.timezone);
  const now = new Date();
  const todayKey = localDateKey(now, orgTz);
  const lastKey = addDaysToKey(todayKey, 7);
  const upcoming = mine
    .filter((x) => {
      const key = taskDayKey(x, props.get(x.propertyId));
      return key > todayKey && key <= lastKey && x.status !== "done" && x.status !== "validated";
    })
    .sort((a, b) => new Date(taskAnchor(a)).getTime() - new Date(taskAnchor(b)).getTime());

  const groups = new Map<string, typeof upcoming>();
  for (const task of upcoming) {
    const key = taskDayKey(task, props.get(task.propertyId));
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }

  return (
    <>
      <h1 className="pb-6 text-display">{t("agentUpcoming.title")}</h1>
      {groups.size === 0 ? (
        <EmptyState icon={CalendarClock} title={t("agentUpcoming.title")} text={t("agentUpcoming.emptyText")} />
      ) : (
        <div className="space-y-8">
          {[...groups.entries()].map(([key, list]) => (
            <section key={key}>
              <h2 className="mb-3 text-title-3 first-letter:uppercase">
                {new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${key}T12:00:00Z`))}
              </h2>
              <ol className="space-y-3">
                {list.map((task) => {
                  const property = props.get(task.propertyId);
                  return property ? (
                    <li key={task.id}>
                      <TaskCard task={task} property={property} reference={new Date(task.windowStart)} />
                    </li>
                  ) : null;
                })}
              </ol>
            </section>
          ))}
        </div>
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
  const agents = activeAgents(members);

  return (
    <>
      <h1 className="pb-6 text-display">{t("profile.title")}</h1>
      {me && (
        <Card className="flex items-center gap-4 p-5">
          <Avatar initials={initialsOf(me.name)} color={me.color} size="lg" />
          <div>
            <div className="text-title-3">{me.name}</div>
            <div className="text-[15px] text-muted">{org.name}</div>
          </div>
        </Card>
      )}

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
