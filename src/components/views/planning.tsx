"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, GripVertical, Hand, Sparkles, Wand2 } from "lucide-react";
import { initialsOf, type Member, type Property, type Task } from "@/lib/domain/types";
import { autoAssign, conflictsIfAssigned, detectConflicts, infeasibility, windowShortfallMin } from "@/lib/engine/conflicts";
import { formatDuration } from "@/lib/engine/learning";
import { placeTask, SNAP_MIN } from "@/lib/engine/schedule";
import { addDaysToKey, formatLocalTime, localDateKey, localMinutesOfDay, formatLocalRange } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { activeAgents, byId, taskAnchor, tasksOfDay } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "@/components/halo/avatar";
import { DayNav } from "@/components/halo/day-nav";
import { EmptyState } from "@/components/halo/empty-state";
import { PageHeader } from "@/components/halo/page-header";
import { ReadyGate } from "@/components/halo/ready-gate";
import { StatusPill } from "@/components/halo/status-pill";
import { TASK_TYPE_META } from "@/components/halo/task-type";
import { TaskSheet } from "@/components/halo/task-sheet";
import { VipBadge } from "@/components/halo/vip-badge";
import { FeasibilityBadge } from "@/components/halo/task-timing";
import { cn } from "@/lib/utils";

const START_H = 7;
const END_H = 22;
const HOUR_PX = 64;
const UNASSIGNED = "__unassigned";

/* ---------- Glisser-déposer : prendre une mission et la poser sur un agent ---------- */
interface DropTarget {
  /** null = remettre « à assigner ». */
  agentId: string | null;
  dayKey: string;
  /** Minutes locales visées (colonne horaire de la vue jour). */
  minutes?: number;
}
interface DragState {
  task: Task;
  x: number;
  y: number;
  grab: number;
  width: number;
  target?: DropTarget;
}

const draggable = (task: Task) => task.status === "unassigned" || task.status === "assigned";

function findTarget(x: number, y: number, grab: number): DropTarget | undefined {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-drop-day]");
  if (!el) return undefined;
  const agent = el.dataset.dropAgent ?? "";
  const target: DropTarget = { agentId: agent === UNASSIGNED ? null : agent, dayKey: el.dataset.dropDay! };
  if (el.dataset.dropTimeline) {
    const rect = el.getBoundingClientRect();
    const raw = START_H * 60 + ((y - grab - rect.top) / HOUR_PX) * 60;
    target.minutes = Math.round(raw / SNAP_MIN) * SNAP_MIN;
  }
  return target;
}

function useDragAssign(onDrop: (task: Task, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const begin = (e: React.PointerEvent<HTMLElement>, task: Task) => {
    if (e.button !== 0 || !draggable(task)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    const grab = Math.min(e.clientY - rect.top, 24);
    let active = false;
    let last: DragState | null = null;
    const move = (ev: PointerEvent) => {
      if (!active && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
      if (!active) {
        active = true;
        document.body.style.userSelect = "none";
        document.body.style.cursor = "grabbing";
      }
      ev.preventDefault();
      last = { task, x: ev.clientX, y: ev.clientY, grab, width: Math.min(rect.width, 240), target: findTarget(ev.clientX, ev.clientY, grab) };
      setDrag(last);
    };
    const end = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      if (active) {
        // Le relâchement ne doit pas ouvrir la fiche de la mission
        const stop = (c: MouseEvent) => {
          c.stopPropagation();
          c.preventDefault();
        };
        window.addEventListener("click", stop, { capture: true, once: true });
        window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 50);
        if (ev.type === "pointerup" && last?.target) onDrop(task, last.target);
      }
      setDrag(null);
    };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
  return { drag, begin };
}

function DragGhost({ drag, property }: { drag: DragState; property?: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  return (
    <div
      className="pointer-events-none fixed z-50 -rotate-2 rounded-md border border-accent bg-surface px-3 py-2 shadow-float"
      style={{ left: drag.x - 16, top: drag.y - drag.grab, width: drag.width }}
      aria-hidden
    >
      <span className={cn("absolute inset-y-0 start-0 w-1 rounded-s-md", TASK_TYPE_META[drag.task.type].bar)} />
      <span className="block truncate text-[13px] font-semibold">{property?.name}</span>
      <span className="block truncate text-caption text-muted">
        {t(`taskType.${drag.task.type}`)} · {formatDuration(drag.task.durationMin, locale)}
      </span>
    </div>
  );
}

export function Planning({ initialDay }: { initialDay?: string }) {
  return (
    <ReadyGate>
      <PlanningInner initialDay={initialDay} />
    </ReadyGate>
  );
}

function PlanningInner({ initialDay }: { initialDay?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const org = useHalo((s) => s.org);
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const members = useHalo((s) => s.members);
  const agents = activeAgents(members);

  const todayKey = localDateKey(new Date(), org.timezone);
  const [view, setView] = useState<"day" | "week" | "month">("day");
  const [dayKey, setDayKey] = useState(initialDay && /^\d{4}-\d{2}-\d{2}$/.test(initialDay) ? initialDay : todayKey);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ReturnType<typeof autoAssign> | null>(null);

  const conflictIds = useMemo(() => new Set(detectConflicts(tasks).map((c) => c.taskId)), [tasks]);
  const dayTasks = tasksOfDay(tasks, properties, dayKey);
  const toAssign = dayTasks.filter((x) => x.status === "unassigned");

  const props = byId(properties);
  const onDrop = (task: Task, target: DropTarget) => {
    const { assignTask } = useHalo.getState();
    if (target.agentId === null) {
      if (task.assigneeId) {
        assignTask(task.id, undefined);
        toast(t("taskSheet.unassignedToast"));
      }
      return;
    }
    const p = props.get(task.propertyId);
    const tz = p?.timezone ?? org.timezone;
    const minutes = target.minutes ?? localMinutesOfDay(new Date(taskAnchor(task)), tz);
    const placed = placeTask(task, target.dayKey, minutes, tz);
    if (!placed.ok) {
      toast(t("planning.dropOutside"));
      return;
    }
    const overlap = conflictsIfAssigned(task, target.agentId, placed.start, tasks).some((c) => c.kind === "overlap");
    assignTask(task.id, target.agentId, placed.start);
    const name = members.find((m) => m.id === target.agentId)?.name ?? "";
    toast(t("planning.dropDone", { name, time: formatLocalTime(new Date(placed.start), tz, locale) }), {
      description: overlap ? t("conflict.overlap") : placed.adjusted ? t("planning.dropAdjusted") : undefined,
    });
  };
  const { drag, begin } = useDragAssign(onDrop);

  const runAuto = () => {
    const result = autoAssign(toAssign, agents.map((a) => a.id), tasks, new Date());
    setProposal(result);
  };

  return (
    <>
      <PageHeader
        title={t("nav.planning")}
        subtitle={
          view === "day"
            ? undefined
            : view === "month"
              ? new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${dayKey.slice(0, 7)}-15T12:00:00Z`))
              : t("planning.weekOf", {
                date: new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${weekStart(dayKey)}T12:00:00Z`)),
              })
        }
        actions={
          <>
            <Segmented
              label={t("planning.view")}
              value={view}
              onChange={setView}
              options={[
                { value: "day", label: t("planning.day") },
                { value: "week", label: t("planning.week") },
                { value: "month", label: t("planning.month") },
              ]}
            />
            <DayNav
              dayKey={dayKey}
              todayKey={todayKey}
              step={view === "day" ? 1 : 7}
              onChange={(d) => {
                if (d === "today") return setDayKey(todayKey);
                if (view === "month") {
                  const [y, m] = dayKey.split("-").map(Number);
                  return setDayKey(new Date(Date.UTC(y, m - 1 + Math.sign(d), 1)).toISOString().slice(0, 10));
                }
                setDayKey(addDaysToKey(dayKey, d));
              }}
            />
          </>
        }
      />

      {view === "day" ? (
        <>
          <DayLabel dayKey={dayKey} />
          {(toAssign.length > 0 || drag) && (
            <Card
              className={cn("mb-4 p-4 transition-shadow", drag?.target?.agentId === null && "ring-2 ring-danger")}
              data-drop-day={dayKey}
              data-drop-agent={UNASSIGNED}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-[15px] font-semibold">
                  <span className="grid size-7 place-items-center rounded-md bg-danger-soft text-danger">
                    <AlertTriangle className="size-4" />
                  </span>
                  {t("planning.toAssign", { count: toAssign.length })}
                </div>
                <span className="hidden items-center gap-1.5 text-caption text-muted md:flex">
                  <Hand className="size-3.5" />
                  {t("planning.dragHint")}
                </span>
                <Button onClick={runAuto} disabled={agents.length === 0}>
                  <Wand2 />
                  {t("planning.autoAssign")}
                </Button>
              </div>
              <ul className="mt-3 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
                {toAssign.map((task) => (
                  <li key={task.id} className="shrink-0">
                    <TaskChip task={task} property={properties.find((p) => p.id === task.propertyId)} onOpen={setOpenTask} onDragStart={begin} dragging={drag?.task.id === task.id} />
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {dayTasks.length === 0 ? (
            <Card>
              <EmptyState icon={Sparkles} title={t("planning.emptyDay")} text={t("planning.emptyDayText")} />
            </Card>
          ) : (
            <>
              <DayGrid
                dayKey={dayKey}
                tasks={dayTasks.filter((x) => x.assigneeId)}
                agents={agents}
                properties={properties}
                conflicts={conflictIds}
                onOpen={setOpenTask}
                drag={drag}
                onDragStart={begin}
              />
              <DayListMobile tasks={dayTasks} agents={agents} properties={properties} conflicts={conflictIds} onOpen={setOpenTask} />
            </>
          )}
        </>
      ) : view === "month" ? (
        <MonthGrid
          monthKey={dayKey.slice(0, 7)}
          todayKey={todayKey}
          tasks={tasks}
          properties={properties}
          onPickDay={(k) => {
            setDayKey(k);
            setView("day");
          }}
        />
      ) : (
        <WeekGrid
          start={weekStart(dayKey)}
          todayKey={todayKey}
          tasks={tasks}
          properties={properties}
          agents={agents}
          conflicts={conflictIds}
          onOpen={setOpenTask}
          onPickDay={(k) => {
            setDayKey(k);
            setView("day");
          }}
          drag={drag}
          onDragStart={begin}
        />
      )}
      {drag && <DragGhost drag={drag} property={props.get(drag.task.propertyId)} />}

      <TaskSheet taskId={openTask} onClose={() => setOpenTask(null)} />
      <AutoAssignSheet
        proposal={proposal}
        pending={toAssign}
        tasks={tasks}
        properties={properties}
        members={members}
        onClose={() => setProposal(null)}
        onConfirm={() => {
          if (!proposal) return;
          useHalo.getState().applyAssignments(proposal);
          toast(t("planning.autoDone", { count: proposal.length }));
          setProposal(null);
        }}
      />
    </>
  );
}

/** Lundi de la semaine d'un jour. */
function weekStart(dayKey: string) {
  const dow = (new Date(`${dayKey}T12:00:00Z`).getUTCDay() + 6) % 7;
  return addDaysToKey(dayKey, -dow);
}

function DayLabel({ dayKey }: { dayKey: string }) {
  const locale = useLocale();
  return (
    <p className="-mt-2 mb-4 text-body text-muted first-letter:uppercase">
      {new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${dayKey}T12:00:00Z`))}
    </p>
  );
}

function TaskChip({
  task,
  property,
  onOpen,
  onDragStart,
  dragging,
}: {
  task: Task;
  property?: Property;
  onOpen: (id: string) => void;
  onDragStart: (e: React.PointerEvent<HTMLElement>, task: Task) => void;
  dragging: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const tz = property?.timezone ?? "UTC";
  return (
    <button
      type="button"
      onClick={() => onOpen(task.id)}
      onPointerDown={(e) => onDragStart(e, task)}
      className={cn(
        "flex items-center gap-2 rounded-lg border border-danger/30 bg-surface py-2 pe-3 ps-1.5 text-start transition-[colors,opacity] hover:bg-danger-soft md:cursor-grab md:touch-none",
        dragging && "opacity-30",
      )}
    >
      <GripVertical className="hidden size-4 shrink-0 text-faint md:block" aria-hidden />
      <span className={cn("h-8 w-1 rounded-full", TASK_TYPE_META[task.type].bar)} aria-hidden />
      <span>
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          {property?.name}
          {task.vip && <VipBadge />}
          <FeasibilityBadge task={task} />
        </span>
        <span className="block text-caption text-muted tabular">
          {t(`taskType.${task.type}`)} · {t("timing.toPlan", { duration: formatDuration(task.durationMin, locale) })} · {t("timing.windowShort", { range: formatLocalRange(new Date(task.windowStart), new Date(task.windowEnd), tz, locale) })}
        </span>
      </span>
    </button>
  );
}

/* ---------- Vue jour (ordinateur) : une colonne par agent ---------- */
function DayGrid({
  dayKey,
  tasks,
  agents,
  properties,
  conflicts,
  onOpen,
  drag,
  onDragStart,
}: {
  dayKey: string;
  tasks: Task[];
  agents: Member[];
  properties: Property[];
  conflicts: Set<string>;
  onOpen: (id: string) => void;
  drag: DragState | null;
  onDragStart: (e: React.PointerEvent<HTMLElement>, task: Task) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const props = byId(properties);
  const hours = Array.from({ length: END_H - START_H + 1 }, (_, i) => START_H + i);
  const top = (min: number) => ((Math.max(min, START_H * 60) - START_H * 60) / 60) * HOUR_PX;

  return (
    <Card className="hidden overflow-hidden md:block">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]" style={{ display: "grid", gridTemplateColumns: `64px repeat(${Math.max(agents.length, 1)}, minmax(160px, 1fr))` }}>
          {/* En-têtes */}
          <div className="sticky top-0 z-10 border-b border-line bg-surface" />
          {agents.map((a) => {
            const mine = tasks.filter((x) => x.assigneeId === a.id);
            const minutes = mine.reduce((n, x) => n + x.durationMin, 0);
            return (
              <div key={a.id} className="sticky top-0 z-10 flex items-center gap-2 border-b border-s border-line bg-surface px-3 py-3">
                <Avatar initials={initialsOf(a.name)} color={a.color} size="sm" className="ring-0" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-semibold">{a.name}</span>
                  <span className="block text-caption text-muted tabular">
                    {mine.length ? `${mine.length} · ${formatDuration(minutes, locale)}` : t(`position.${a.position ?? "housekeeper"}`)}
                  </span>
                </span>
              </div>
            );
          })}

          {/* Heures */}
          <div className="relative" style={{ height: (END_H - START_H) * HOUR_PX }}>
            {hours.map((h) => (
              <span key={h} className={cn("absolute end-2 text-caption text-muted tabular", h === START_H ? "translate-y-1" : "-translate-y-1/2")} style={{ top: (h - START_H) * HOUR_PX }}>
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {/* Colonnes agents */}
          {agents.map((a) => (
            <div
              key={a.id}
              className={cn("relative border-s border-line transition-colors", drag?.target?.agentId === a.id && "bg-accent-soft/50")}
              style={{ height: (END_H - START_H) * HOUR_PX }}
              data-drop-day={dayKey}
              data-drop-agent={a.id}
              data-drop-timeline="1"
            >
              {hours.map((h) => (
                <span key={h} className="absolute inset-x-0 border-t border-line/60" style={{ top: (h - START_H) * HOUR_PX }} aria-hidden />
              ))}
              {drag?.target?.agentId === a.id && drag.target.minutes !== undefined && <DropPreview drag={drag} dayKey={dayKey} property={props.get(drag.task.propertyId)} top={top} />}
              {tasks
                .filter((x) => x.assigneeId === a.id)
                .map((task) => {
                  const p = props.get(task.propertyId);
                  const tz = p?.timezone ?? "UTC";
                  const start = localMinutesOfDay(new Date(taskAnchor(task)), tz);
                  const height = Math.max((task.durationMin / 60) * HOUR_PX - 4, 28);
                  const conflict = conflicts.has(task.id);
                  const done = task.status === "done" || task.status === "validated";
                  return (
                    <button
                      key={task.id}
                      type="button"
                      onClick={() => onOpen(task.id)}
                      onPointerDown={(e) => onDragStart(e, task)}
                      className={cn(
                        "absolute inset-x-1.5 overflow-hidden rounded-md border bg-surface px-2.5 py-1.5 text-start shadow-card transition-[box-shadow,opacity] hover:shadow-float",
                        conflict ? "border-warning ring-1 ring-warning" : "border-line",
                        done && "opacity-60",
                        draggable(task) && "cursor-grab touch-none",
                        drag?.task.id === task.id && "opacity-25",
                      )}
                      style={{ top: top(start) + 2, height }}
                    >
                      <span className={cn("absolute inset-y-0 start-0 w-1", TASK_TYPE_META[task.type].bar)} aria-hidden />
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px] font-semibold">{p?.name}</span>
                        {task.vip && <VipBadge className="px-1.5 py-0" />}
                        {conflict && <AlertTriangle className="size-3.5 shrink-0 text-warning" aria-label={t("conflict.overlap")} />}
                      </span>
                      {height > 40 && (
                        <span className="block truncate text-caption text-muted tabular">
                          {formatLocalTime(new Date(taskAnchor(task)), tz, locale)}–{formatLocalTime(new Date(new Date(taskAnchor(task)).getTime() + task.durationMin * 60_000), tz, locale)} · {t(`taskType.${task.type}`)}
                        </span>
                      )}
                      {height > 64 && <StatusPill status={task.status} className="mt-1" />}
                    </button>
                  );
                })}
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/** Fantôme de dépôt : où la mission va réellement atterrir (recalée dans sa fenêtre). */
function DropPreview({ drag, dayKey, property, top }: { drag: DragState; dayKey: string; property?: Property; top: (min: number) => number }) {
  const t = useTranslations();
  const locale = useLocale();
  const tz = property?.timezone ?? "UTC";
  const placed = placeTask(drag.task, dayKey, drag.target?.minutes ?? 0, tz);
  const minutes = placed.ok ? localMinutesOfDay(new Date(placed.start), tz) : drag.target?.minutes ?? 0;
  const height = Math.max((drag.task.durationMin / 60) * HOUR_PX - 4, 28);
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-x-1.5 z-10 rounded-md border-2 border-dashed px-2.5 py-1.5",
        !placed.ok ? "border-danger bg-danger-soft/70" : placed.adjusted ? "border-warning bg-warning-soft/70" : "border-accent bg-accent-soft/70",
      )}
      style={{ top: top(minutes) + 2, height }}
    >
      <span className={cn("text-[13px] font-bold tabular", !placed.ok ? "text-danger" : placed.adjusted ? "text-warning" : "text-accent-text")}>
        {placed.ok ? formatLocalTime(new Date(placed.start), tz, locale) : t("planning.outsideWindow")}
      </span>
    </div>
  );
}

/* ---------- Vue jour (téléphone) : choix de l'agent puis liste ---------- */
function DayListMobile({
  tasks,
  agents,
  properties,
  conflicts,
  onOpen,
}: {
  tasks: Task[];
  agents: Member[];
  properties: Property[];
  conflicts: Set<string>;
  onOpen: (id: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const props = byId(properties);
  const [who, setWho] = useState<string>(agents[0]?.id ?? UNASSIGNED);
  const list = tasks.filter((x) => (who === UNASSIGNED ? !x.assigneeId : x.assigneeId === who));

  return (
    <div className="md:hidden">
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist" aria-label={t("planning.agents")}>
        {agents.map((a) => {
          const n = tasks.filter((x) => x.assigneeId === a.id).length;
          return (
            <button
              key={a.id}
              role="tab"
              aria-selected={who === a.id}
              onClick={() => setWho(a.id)}
              className={cn(
                "flex h-11 shrink-0 items-center gap-2 rounded-full border px-3 text-[14px] font-medium",
                who === a.id ? "border-fg bg-fg text-canvas" : "border-line bg-surface",
              )}
            >
              <Avatar initials={initialsOf(a.name)} color={a.color} size="sm" className="ring-0" />
              {a.name.split(" ")[0]}
              <span className="tabular opacity-70">{n}</span>
            </button>
          );
        })}
      </div>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={Sparkles} title={t("planning.nothingForAgent")} className="py-10" />
        </Card>
      ) : (
        <Card className="divide-y divide-line">
          {list.map((task) => {
            const p = props.get(task.propertyId);
            const tz = p?.timezone ?? "UTC";
            return (
              <button key={task.id} type="button" onClick={() => onOpen(task.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start">
                <span className={cn("h-10 w-1 shrink-0 rounded-full", TASK_TYPE_META[task.type].bar)} aria-hidden />
                <span className="w-12 shrink-0 text-[15px] font-semibold tabular">
                  {task.scheduledStart ? formatLocalTime(new Date(task.scheduledStart), tz, locale) : <span className="text-caption font-medium text-muted">{formatDuration(task.durationMin, locale)}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[15px] font-semibold">{p?.name}</span>
                    {conflicts.has(task.id) && <AlertTriangle className="size-4 shrink-0 text-warning" />}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
                    {t(`taskType.${task.type}`)} · <StatusPill status={task.status} />
                    <FeasibilityBadge task={task} />
                  </span>
                </span>
              </button>
            );
          })}
        </Card>
      )}
    </div>
  );
}

/* ---------- Vue semaine : agents × jours ---------- */
function WeekGrid({
  start,
  todayKey,
  tasks,
  properties,
  agents,
  conflicts,
  onOpen,
  onPickDay,
  drag,
  onDragStart,
}: {
  start: string;
  todayKey: string;
  tasks: Task[];
  properties: Property[];
  agents: Member[];
  conflicts: Set<string>;
  onOpen: (id: string) => void;
  onPickDay: (dayKey: string) => void;
  drag: DragState | null;
  onDragStart: (e: React.PointerEvent<HTMLElement>, task: Task) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const days = Array.from({ length: 7 }, (_, i) => addDaysToKey(start, i));
  const props = byId(properties);
  const byDay = new Map(days.map((d) => [d, tasksOfDay(tasks, properties, d)]));
  const rows: { id: string; label: string; member?: Member }[] = [
    { id: UNASSIGNED, label: t("planning.unassignedRow") },
    ...agents.map((a) => ({ id: a.id, label: a.name, member: a })),
  ];

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] table-fixed border-collapse">
          <thead>
            <tr>
              <th scope="col" className="w-44 border-b border-line p-3 text-start text-micro text-muted">
                {t("planning.agents")}
              </th>
              {days.map((d) => (
                <th key={d} scope="col" className="border-b border-s border-line p-2 text-center">
                  <button type="button" onClick={() => onPickDay(d)} className="mx-auto flex flex-col items-center rounded-md px-2 py-1 hover:bg-subtle dark:hover:bg-surface-hover">
                    <span className="text-micro text-muted">
                      {new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))}
                    </span>
                    <span className={cn("mt-0.5 grid size-7 place-items-center rounded-full text-[14px] font-semibold tabular", d === todayKey && "bg-fg text-canvas")}>
                      {Number(d.slice(8))}
                    </span>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <th scope="row" className="border-b border-line p-3 text-start align-top">
                  <span className="flex items-center gap-2">
                    {row.member ? (
                      <Avatar initials={initialsOf(row.member.name)} color={row.member.color} size="sm" className="ring-0" />
                    ) : (
                      <span className="grid size-6 place-items-center rounded-full border border-dashed border-danger/60" aria-hidden />
                    )}
                    <span className={cn("truncate text-[14px] font-semibold", !row.member && "text-danger")}>{row.label}</span>
                  </span>
                </th>
                {days.map((d) => {
                  const cell = (byDay.get(d) ?? []).filter((x) => (row.id === UNASSIGNED ? x.status === "unassigned" : x.assigneeId === row.id));
                  const hovered = drag?.target?.dayKey === d && (drag.target.agentId ?? UNASSIGNED) === row.id;
                  return (
                    <td
                      key={d}
                      className={cn(
                        "h-14 border-b border-s border-line p-1.5 align-top transition-colors",
                        d === todayKey && "bg-accent-soft/40",
                        hovered && "bg-accent-soft outline outline-2 -outline-offset-2 outline-accent",
                      )}
                      data-drop-day={d}
                      data-drop-agent={row.id}
                    >
                      <ul className="space-y-1">
                        {cell.map((task) => {
                          const p = props.get(task.propertyId);
                          return (
                            <li key={task.id}>
                              <button
                                type="button"
                                onClick={() => onOpen(task.id)}
                                onPointerDown={(e) => onDragStart(e, task)}
                                className={cn(
                                  "relative w-full overflow-hidden rounded-md border bg-surface py-1 pe-1.5 ps-2.5 text-start text-[12px] leading-4 transition-[colors,opacity] hover:bg-surface-hover",
                                  conflicts.has(task.id) ? "border-warning" : row.id === UNASSIGNED ? "border-danger/40" : "border-line",
                                  draggable(task) && "cursor-grab touch-none",
                                  drag?.task.id === task.id && "opacity-25",
                                )}
                              >
                                <span className={cn("absolute inset-y-0 start-0 w-1", TASK_TYPE_META[task.type].bar)} aria-hidden />
                                <span className="flex items-center gap-1 truncate font-semibold">
                                  <span className="truncate">{p?.name}</span>
                                  {infeasibility(task, new Date()) && <AlertTriangle className="size-3 shrink-0 text-danger" aria-label={t("feasibility.issue")} />}
                                </span>
                                <span className="block truncate text-muted tabular">
                                  {task.scheduledStart ? (
                                    <>
                                      {formatLocalTime(new Date(task.scheduledStart), p?.timezone ?? "UTC", locale)}–
                                      {formatLocalTime(new Date(new Date(task.scheduledStart).getTime() + task.durationMin * 60_000), p?.timezone ?? "UTC", locale)}
                                    </>
                                  ) : (
                                    // Non planifiée : pas de faux créneau, seulement la durée à placer
                                    t("timing.toPlan", { duration: formatDuration(task.durationMin, locale) })
                                  )}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ---------- Vue mois : charge par jour ---------- */
function MonthGrid({
  monthKey,
  todayKey,
  tasks,
  properties,
  onPickDay,
}: {
  monthKey: string;
  todayKey: string;
  tasks: Task[];
  properties: Property[];
  onPickDay: (dayKey: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const props = byId(properties);
  const [y, m] = monthKey.split("-").map(Number);
  const first = `${monthKey}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: daysInMonth }, (_, i) => addDaysToKey(first, i));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5 + i, 12))),
  );

  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-7 border-b border-line">
        {weekdays.map((d) => (
          <span key={d} className="px-2 py-2.5 text-center text-micro text-muted">
            {d}
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: lead }, (_, i) => (
          <span key={`l${i}`} className="border-b border-e border-line bg-subtle/50 dark:bg-surface-hover/30" />
        ))}
        {days.map((d) => {
          const list = tasksOfDay(tasks, properties, d);
          const open = list.filter((x) => x.status === "unassigned").length;
          const cleanings = list.filter((x) => x.type === "turnover").length;
          return (
            <button
              key={d}
              type="button"
              onClick={() => onPickDay(d)}
              className={cn(
                "flex min-h-20 flex-col gap-1 border-b border-e border-line p-1.5 text-start transition-colors hover:bg-surface-hover md:min-h-28 md:p-2",
                d < todayKey && "opacity-60",
              )}
              aria-label={`${new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`))} — ${t("tasks.count", { count: list.length })}`}
            >
              <span className="flex items-center justify-between">
                <span className={cn("grid size-6 place-items-center rounded-full text-[13px] font-semibold tabular", d === todayKey && "bg-fg text-canvas")}>
                  {Number(d.slice(8))}
                </span>
                {open > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-danger px-1 text-[11px] font-bold text-white">{open}</span>}
              </span>
              {/* Téléphone : compteur ; ordinateur : aperçu des missions */}
              {list.length > 0 && (
                <span className="text-caption text-muted md:hidden">
                  {cleanings > 0 ? `${cleanings}×` : list.length}
                  <span className="ms-0.5 inline-block size-1.5 rounded-full bg-type-turnover align-middle" />
                </span>
              )}
              <span className="hidden flex-col gap-0.5 md:flex">
                {list.slice(0, 3).map((x) => (
                  <span key={x.id} className="relative truncate rounded-sm bg-subtle py-0.5 pe-1 ps-2 text-[11px] leading-4 dark:bg-surface-hover">
                    <span className={cn("absolute inset-y-0 start-0 w-0.5", TASK_TYPE_META[x.type].bar)} aria-hidden />
                    {props.get(x.propertyId)?.name}
                  </span>
                ))}
                {list.length > 3 && <span className="text-[11px] text-muted">{t("planning.more", { count: list.length - 3 })}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------- Aperçu de la répartition automatique ---------- */
function AutoAssignSheet({
  proposal,
  pending,
  tasks,
  properties,
  members,
  onClose,
  onConfirm,
}: {
  proposal: ReturnType<typeof autoAssign> | null;
  pending: Task[];
  tasks: Task[];
  properties: Property[];
  members: Member[];
  onClose: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();
  if (!proposal) return null;
  const props = byId(properties);
  const people = byId(members);
  const now = new Date();
  // Chaque mission non placée avec sa vraie raison (aucune n'est déclarée réalisable à tort)
  const notPlaced = pending.filter((x) => !proposal.some((a) => a.taskId === x.id));

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={t("planning.autoTitle")} description={t("planning.autoHint")} closeLabel={t("common.close")}>
        <div className="space-y-4 pt-2">
          {proposal.length === 0 ? (
            <p className="rounded-lg bg-warning-soft p-3 text-[14px]">{t("planning.autoNone")}</p>
          ) : (
            <ul className="divide-y divide-line rounded-lg border border-line">
              {proposal.map((a) => {
                const task = tasks.find((x) => x.id === a.taskId)!;
                const p = props.get(task.propertyId);
                const agent = people.get(a.agentId);
                return (
                  <li key={a.taskId} className="flex items-center gap-3 px-3 py-2.5">
                    {agent && <Avatar initials={initialsOf(agent.name)} color={agent.color} size="md" className="ring-0" />}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold">{p?.name}</span>
                      <span className="block text-caption text-muted">
                        {agent?.name} · {formatLocalTime(new Date(a.scheduledStart), p?.timezone ?? "UTC", locale)} →{" "}
                        {formatLocalTime(new Date(new Date(a.scheduledStart).getTime() + task.durationMin * 60_000), p?.timezone ?? "UTC", locale)} ({formatDuration(task.durationMin, locale)})
                      </span>
                    </span>
                    <Badge>{t(`taskType.${task.type}`)}</Badge>
                  </li>
                );
              })}
            </ul>
          )}
          {notPlaced.length > 0 && (
            <div className="rounded-lg bg-warning-soft p-3 text-[14px]">
              <p className="font-medium text-warning">{t("planning.autoNotPlaced", { count: notPlaced.length })}</p>
              <ul className="mt-1.5 space-y-1">
                {notPlaced.map((x) => {
                  const p = props.get(x.propertyId);
                  const why = infeasibility(x, now);
                  return (
                    <li key={x.id}>
                      <strong>{p?.name}</strong> — {why === "window_too_short"
                        ? t("feasibility.tooShortBadge", { missing: formatDuration(windowShortfallMin(x), locale) })
                        : why
                          ? t(`feasibility.${why}Title`)
                          : t("feasibility.noAgentFree")}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" size="lg" onClick={onClose}>
              {t("form.cancel")}
            </Button>
            <Button size="lg" className="flex-1" onClick={onConfirm} disabled={proposal.length === 0}>
              {t("planning.autoConfirm", { count: proposal.length })}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
