"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ListChecks, Plus, Search } from "lucide-react";
import { initialsOf, type TaskStatus, type TaskType } from "@/lib/domain/types";
import { addDaysToKey, formatLocalTime, localDateKey } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { byId, taskAnchor, taskDayKey } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Avatar } from "@/components/halo/avatar";
import { EmptyState } from "@/components/halo/empty-state";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { StatusPill } from "@/components/halo/status-pill";
import { TaskCreateSheet } from "@/components/halo/task-create-sheet";
import { TaskSheet } from "@/components/halo/task-sheet";
import { TaskTypeIcon } from "@/components/halo/task-type";

type Period = "today" | "week" | "upcoming" | "past";
type StatusFilter = "all" | "todo" | TaskStatus;
const STATUS_FILTERS: StatusFilter[] = ["all", "todo", "unassigned", "assigned", "in_progress", "done", "to_redo", "validated", "cancelled"];
const TYPES: TaskType[] = ["turnover", "check_in", "check_out", "linen_delivery", "linen_pickup", "inspection", "other"];

export function TasksList() {
  return (
    <ReadyGate>
      <TasksListInner />
    </ReadyGate>
  );
}

function TasksListInner() {
  const t = useTranslations();
  const locale = useLocale();
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const members = useHalo((s) => s.members);
  const orgTz = useHalo((s) => s.org.timezone);
  const [period, setPeriod] = useState<Period>("week");
  const [status, setStatus] = useState<StatusFilter>("todo");
  const [type, setType] = useState<TaskType | "all">("all");
  const [propertyId, setPropertyId] = useState("all");
  const [query, setQuery] = useState("");
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const props = byId(properties);
  const people = byId(members);
  const todayKey = localDateKey(new Date(), orgTz);
  const q = query.trim().toLocaleLowerCase(locale);

  const list = tasks
    .filter((x) => {
      const key = taskDayKey(x, props.get(x.propertyId));
      if (period === "today" && key !== todayKey) return false;
      if (period === "week" && (key < todayKey || key > addDaysToKey(todayKey, 6))) return false;
      if (period === "upcoming" && key < todayKey) return false;
      if (period === "past" && key >= todayKey) return false;
      if (status === "todo" && !["unassigned", "assigned", "in_progress", "to_redo", "done"].includes(x.status)) return false;
      if (status !== "all" && status !== "todo" && x.status !== status) return false;
      if (status !== "cancelled" && status !== "all" && x.status === "cancelled") return false;
      if (type !== "all" && x.type !== type) return false;
      if (propertyId !== "all" && x.propertyId !== propertyId) return false;
      if (q) {
        const hay = [props.get(x.propertyId)?.name, people.get(x.assigneeId ?? "")?.name, t(`taskType.${x.type}`)].join(" ").toLocaleLowerCase(locale);
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) =>
      period === "past"
        ? new Date(taskAnchor(b)).getTime() - new Date(taskAnchor(a)).getTime()
        : new Date(taskAnchor(a)).getTime() - new Date(taskAnchor(b)).getTime(),
    );

  const when = (iso: string, tz: string) =>
    new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

  return (
    <>
      <PageHeader
        title={t("nav.tasks")}
        subtitle={t("tasks.count", { count: list.length })}
        actions={
          <Button onClick={() => setCreating(true)} disabled={properties.length === 0}>
            <Plus />
            {t("tasks.new")}
          </Button>
        }
      />

      <div className="mb-4 space-y-3">
        <Segmented
          label={t("tasks.period")}
          value={period}
          onChange={setPeriod}
          className="flex w-full md:inline-flex md:w-auto"
          options={[
            { value: "today", label: t("common.today") },
            { value: "week", label: t("tasks.next7") },
            { value: "upcoming", label: t("tasks.upcoming") },
            { value: "past", label: t("tasks.past") },
          ]}
        />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <div className="relative col-span-2 md:col-span-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 size-[18px] -translate-y-1/2 text-faint" aria-hidden />
            <Input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("tasks.search")} aria-label={t("tasks.search")} className="ps-10" />
          </div>
          <Select aria-label={t("tasks.status")} value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? t("tasks.allStatuses") : s === "todo" ? t("tasks.todo") : t(`taskStatus.${s}`)}
              </option>
            ))}
          </Select>
          <Select aria-label={t("tasks.type")} value={type} onChange={(e) => setType(e.target.value as TaskType | "all")}>
            <option value="all">{t("tasks.allTypes")}</option>
            {TYPES.map((x) => (
              <option key={x} value={x}>
                {t(`taskType.${x}`)}
              </option>
            ))}
          </Select>
          <Select aria-label={t("tasks.property")} value={propertyId} onChange={(e) => setPropertyId(e.target.value)} className="col-span-2 md:col-span-1">
            <option value="all">{t("tasks.allProperties")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={ListChecks} title={t("tasks.empty")} text={t("tasks.emptyText")} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Ordinateur */}
          <table className="hidden w-full md:table">
            <thead>
              <tr className="border-b border-line text-micro text-muted">
                <th scope="col" className="px-5 py-3 text-start font-semibold">{t("tasks.date")}</th>
                <th scope="col" className="py-3 pe-4 text-start font-semibold">{t("managerToday.colTime")}</th>
                <th scope="col" className="py-3 pe-4 text-start font-semibold">{t("managerToday.colProperty")}</th>
                <th scope="col" className="py-3 pe-4 text-start font-semibold">{t("managerToday.colTask")}</th>
                <th scope="col" className="py-3 pe-4 text-start font-semibold">{t("managerToday.colAgent")}</th>
                <th scope="col" className="py-3 pe-5 text-start font-semibold">{t("managerToday.colStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((task) => {
                const p = props.get(task.propertyId);
                const a = people.get(task.assigneeId ?? "");
                const tz = p?.timezone ?? "UTC";
                return (
                  <tr key={task.id} onClick={() => setOpenTask(task.id)} className="cursor-pointer border-b border-line last:border-b-0 hover:bg-surface-hover">
                    <td className="px-5 py-3 text-[14px] first-letter:uppercase">{when(taskAnchor(task), tz)}</td>
                    <td className="py-3 pe-4 text-[14px] font-semibold tabular">
                      {formatLocalTime(new Date(task.windowStart), tz, locale)} → {formatLocalTime(new Date(task.windowEnd), tz, locale)}
                    </td>
                    <td className="py-3 pe-4">
                      <button type="button" className="text-start text-[14px] font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setOpenTask(task.id); }}>
                        {p?.name}
                      </button>
                      {task.priority !== "normal" && (
                        <Badge tone="danger" className="ms-2 px-1.5">
                          {t(`priority.${task.priority}`)}
                        </Badge>
                      )}
                    </td>
                    <td className="py-3 pe-4">
                      <span className="flex items-center gap-2 text-[14px] text-muted">
                        <TaskTypeIcon type={task.type} size="sm" className="size-6 [&_svg]:size-3.5" />
                        {t(`taskType.${task.type}`)}
                      </span>
                    </td>
                    <td className="py-3 pe-4 text-[14px]">
                      {a ? (
                        <span className="flex items-center gap-2">
                          <Avatar initials={initialsOf(a.name)} color={a.color} size="sm" className="ring-0" />
                          {a.name}
                        </span>
                      ) : (
                        <span className="text-danger">{t("task.unassigned")}</span>
                      )}
                    </td>
                    <td className="py-3 pe-5">
                      <StatusPill status={task.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Téléphone */}
          <ul className="divide-y divide-line md:hidden">
            {list.map((task) => {
              const p = props.get(task.propertyId);
              const a = people.get(task.assigneeId ?? "");
              const tz = p?.timezone ?? "UTC";
              return (
                <li key={task.id}>
                  <button type="button" onClick={() => setOpenTask(task.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start">
                    <TaskTypeIcon type={task.type} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{p?.name}</span>
                      <span className="mt-0.5 block truncate text-caption text-muted first-letter:uppercase">
                        {when(taskAnchor(task), tz)} · {formatLocalTime(new Date(task.windowStart), tz, locale)}
                      </span>
                      <span className="mt-1 block">
                        <StatusPill status={task.status} />
                      </span>
                    </span>
                    {a ? <Avatar initials={initialsOf(a.name)} color={a.color} size="md" label={a.name} /> : <span className="size-8 shrink-0 rounded-full border border-dashed border-danger/60" aria-label={t("task.unassigned")} />}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <TaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      <TaskCreateSheet open={creating} onOpenChange={setCreating} />
    </>
  );
}
