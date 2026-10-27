"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, CalendarClock, Check, Clock, Minus, Plus, RotateCcw, Sparkles, Timer, Users, XCircle } from "lucide-react";
import { initialsOf, type Task, type TaskStatus } from "@/lib/domain/types";
import { conflictsIfAssigned } from "@/lib/engine/conflicts";
import { formatDuration, learnedCleaningDuration } from "@/lib/engine/learning";
import { formatLocalTime, isSameLocalDay, formatLocalRange } from "@/lib/engine/time";
import { activeAgents, taskDayKey } from "@/lib/store/selectors";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar } from "./avatar";
import { TaskLinenKit } from "@/components/linen/task-linen-kit";
import { GuestBadges } from "./guest-badges";
import { StatusPill } from "./status-pill";
import { TaskReportView } from "./task-report";
import { FeasibilityBadge, FeasibilityExplain, useTaskTiming } from "./task-timing";
import { VipBadge } from "./vip-badge";
import { TaskTypeIcon } from "./task-type";
import { cn } from "@/lib/utils";

const STEP_MS = 15 * 60_000;

/** Heures de début possibles : toutes les 15 min dans la fenêtre, en laissant la durée. */
export function startSlots(task: Pick<Task, "windowStart" | "windowEnd" | "durationMin">, now: Date = new Date()) {
  // Jamais de début proposé dans le passé
  const ws = Math.max(new Date(task.windowStart).getTime(), now.getTime());
  const we = new Date(task.windowEnd).getTime();
  const last = Math.min(we - task.durationMin * 60_000, ws + 24 * 3_600_000);
  const slots: string[] = [];
  for (let t = Math.ceil(ws / STEP_MS) * STEP_MS; t <= last; t += STEP_MS) slots.push(new Date(t).toISOString());
  if (slots.length === 0) slots.push(new Date(ws).toISOString());
  return slots;
}

export function TaskSheet({ taskId, onClose }: { taskId: string | null; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const reservations = useHalo((s) => s.reservations);
  const members = useHalo((s) => s.members);
  const { assignTask, setTaskStatus, updateTask, setTaskDuration } = useHalo.getState();
  const timing = useTaskTiming();

  const task = tasks.find((x) => x.id === taskId);
  const property = task ? properties.find((p) => p.id === task.propertyId) : undefined;
  const agents = activeAgents(members);
  const [redoReason, setRedoReason] = useState("");
  const [showRedo, setShowRedo] = useState(false);

  const slots = useMemo(() => (task ? startSlots(task) : []), [task]);
  const [lastTaskId, setLastTaskId] = useState(taskId);
  if (taskId !== lastTaskId) {
    setLastTaskId(taskId);
    setShowRedo(false);
    setRedoReason("");
  }

  if (!task || !property) return null;

  const tz = property.timezone;
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const time = formatLocalTime(d, tz, locale);
    if (isSameLocalDay(d, new Date(task.windowStart), tz)) return time;
    return `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric" }).format(d)} ${time}`;
  };
  const dayLabel = new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(task.windowStart));
  const incoming = reservations.find((r) => r.id === task.nextReservationId);
  const outgoing = reservations.find((r) => r.id === task.reservationId);
  const assignable = task.status === "unassigned" || task.status === "assigned";
  const selectedStart = task.scheduledStart ?? slots[0];
  const dayKey = taskDayKey(task, property);
  const learned = property.learnDuration === false ? null : learnedCleaningDuration(property.id, tasks);

  const assign = (agentId: string | undefined) => {
    const overlap = agentId ? conflictsIfAssigned(task, agentId, selectedStart, tasks).some((c) => c.kind === "overlap") : false;
    assignTask(task.id, agentId, agentId ? selectedStart : undefined);
    const name = members.find((m) => m.id === agentId)?.name;
    toast(agentId ? t("taskSheet.assignedTo", { name: name ?? "" }) : t("taskSheet.unassignedToast"), {
      description: overlap ? t("conflict.overlap") : undefined,
    });
  };

  const status = (s: TaskStatus, message: string) => {
    setTaskStatus(task.id, s);
    toast(message);
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={property.name} description={`${t(`taskType.${task.type}`)} · ${dayLabel}`} closeLabel={t("common.close")}>
        <div className="space-y-6 pt-2">
          {/* Résumé */}
          <div className="flex flex-wrap items-center gap-2">
            <TaskTypeIcon type={task.type} size="sm" />
            <StatusPill status={task.status} />
            {task.priority !== "normal" && <Badge tone="danger">{t(`priority.${task.priority}`)}</Badge>}
            {!task.isAutoGenerated && <Badge>{t("taskSheet.manual")}</Badge>}
            {task.vip && <VipBadge />}
            <FeasibilityBadge task={task} />
          </div>
          <FeasibilityExplain task={task} tz={tz} />

          <dl className="grid grid-cols-2 gap-3">
            {/* Fenêtre d'intervention : quand la mission PEUT être faite (≠ durée du travail) */}
            <div className="col-span-2 rounded-lg bg-subtle p-3 dark:bg-surface-hover">
              <dt className="flex items-center gap-1.5 text-caption text-muted">
                <Clock className="size-3.5" /> {t("taskSheet.window")}
              </dt>
              <dd className="mt-1 text-[15px] font-semibold tabular">
                {formatLocalRange(new Date(task.windowStart), new Date(task.windowEnd), tz, locale)}
              </dd>
              <dd className="mt-0.5 text-caption text-muted first-letter:uppercase">
                {t("taskSheet.deadline", {
                  date: `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(task.windowEnd))} ${formatLocalTime(new Date(task.windowEnd), tz, locale)}`,
                })}
              </dd>
            </div>
            {/* Créneau planifié : ce que l'agent fait réellement (base des conflits) */}
            <div className="rounded-lg bg-subtle p-3 dark:bg-surface-hover">
              <dt className="flex items-center gap-1.5 text-caption text-muted">
                <CalendarClock className="size-3.5" /> {t("taskSheet.slot")}
              </dt>
              <dd className="mt-1 text-[15px] font-semibold tabular">{timing.slot(task, tz) ?? t("taskSheet.notScheduled")}</dd>
              <dd className="mt-0.5 text-caption text-muted">{t("taskSheet.estimatedDuration", { time: timing.duration(task) })}</dd>
            </div>
            <div className="rounded-lg bg-subtle p-3 dark:bg-surface-hover">
              <dt className="flex items-center gap-1.5 text-caption text-muted">
                <Users className="size-3.5" /> {t("taskSheet.guests")}
              </dt>
              <dd className="mt-1 text-[15px] font-semibold">
                {task.guestsCount ? t("task.guests", { count: task.guestsCount }) : "—"}
              </dd>
              {(task.babies || task.pets) && (
                <dd className="mt-1">
                  <GuestBadges babies={task.babies} pets={task.pets} size="sm" />
                </dd>
              )}
            </div>
          </dl>
          {(outgoing || incoming) && (
            <p className="text-caption text-muted">
              {outgoing && t("taskSheet.departure", { name: outgoing.guestName ?? t(`source.${outgoing.source}`) })}
              {outgoing && incoming && " · "}
              {incoming && t("taskSheet.arrival", { name: incoming.guestName ?? t(`source.${incoming.source}`) })}
            </p>
          )}

          <TaskLinenKit task={task} property={property} />

          {/* Durée prévue : apprise des pointages, ajustable */}
          {assignable && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-caption text-muted">
                  <Timer className="size-3.5" />
                  {t("taskSheet.duration")}
                </p>
                <p className="text-title-3 tabular">{formatDuration(task.durationMin, locale)}</p>
                <p className="mt-0.5 flex items-center gap-1 text-caption text-muted">
                  {task.durationLocked ? (
                    t("taskSheet.durationManual")
                  ) : learned && task.type === "turnover" ? (
                    <>
                      <Sparkles className="size-3 text-accent-text" />
                      {t("taskSheet.durationLearned", { count: learned.samples })}
                    </>
                  ) : (
                    t("taskSheet.durationDefault")
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="secondary" size="icon" aria-label={t("taskSheet.durationLess")} onClick={() => setTaskDuration(task.id, task.durationMin - 15)} disabled={task.durationMin <= 15}>
                  <Minus />
                </Button>
                <Button variant="secondary" size="icon" aria-label={t("taskSheet.durationMore")} onClick={() => setTaskDuration(task.id, task.durationMin + 15)}>
                  <Plus />
                </Button>
              </div>
            </div>
          )}

          {/* Assignation */}
          {assignable && (
            <section>
              <h3 className="mb-2 text-micro text-muted">{t("taskSheet.assign")}</h3>
              <Field label={t("taskSheet.startAt")} htmlFor="start">
                <Select
                  id="start"
                  value={selectedStart}
                  onChange={(e) => {
                    if (task.assigneeId) assignTask(task.id, task.assigneeId, e.target.value);
                    else updateTask(task.id, { scheduledStart: e.target.value });
                  }}
                >
                  {slots.map((s) => (
                    <option key={s} value={s}>
                      {fmt(s)}
                    </option>
                  ))}
                </Select>
              </Field>
              <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
                {agents.map((agent) => {
                  const conflicts = conflictsIfAssigned(task, agent.id, selectedStart, tasks);
                  const selected = task.assigneeId === agent.id;
                  const dayLoad = tasks.filter(
                    (x) => x.id !== task.id && x.assigneeId === agent.id && x.status !== "cancelled" && taskDayKey(x, properties.find((p) => p.id === x.propertyId)) === dayKey,
                  );
                  const loadMin = dayLoad.reduce((n, x) => n + x.durationMin, 0);
                  return (
                    <li key={agent.id}>
                      <button
                        type="button"
                        onClick={() => assign(selected ? undefined : agent.id)}
                        aria-pressed={selected}
                        className={cn(
                          "flex min-h-14 w-full items-center gap-3 px-3 py-2 text-start transition-colors hover:bg-surface-hover",
                          selected && "bg-accent-soft hover:bg-accent-soft",
                        )}
                      >
                        <Avatar initials={initialsOf(agent.name)} color={agent.color} size="md" className="ring-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[15px] font-medium">{agent.name}</span>
                          <span className="block text-caption text-muted tabular">
                            {dayLoad.length > 0
                              ? t("taskSheet.agentLoad", { count: dayLoad.length, time: formatDuration(loadMin, locale) })
                              : conflicts.some((c) => c.kind === "overlap")
                                ? t("conflict.overlap")
                                : t("taskSheet.agentFree")}
                            {" · "}
                            {t("taskSheet.endAt", { time: fmt(new Date(new Date(selectedStart).getTime() + task.durationMin * 60_000).toISOString()) })}
                          </span>
                          {conflicts.length > 0 && (
                            <span className="mt-0.5 flex items-center gap-1 text-caption text-warning">
                              <AlertTriangle className="size-3.5" />
                              {conflicts.some((c) => c.kind === "overlap") ? t("conflict.overlap") : t("conflict.outside_window")}
                            </span>
                          )}
                        </span>
                        {selected && <Check className="size-5 text-accent-text" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {!assignable && task.assigneeId && (
            <div className="flex items-center gap-3">
              {(() => {
                const a = members.find((m) => m.id === task.assigneeId);
                return a ? (
                  <>
                    <Avatar initials={initialsOf(a.name)} color={a.color} size="md" className="ring-0" />
                    <span className="text-[15px] font-medium">{a.name}</span>
                  </>
                ) : null;
              })()}
            </div>
          )}

          <TaskReportView task={task} property={property} />

          {/* Traçabilité : reprise et validation */}
          {(task.previousWorkMin || task.validatedAt) && (
            <ul className="space-y-1 text-caption text-muted">
              {task.previousWorkMin ? <li>{t("taskSheet.redoTrace", { time: formatDuration(task.previousWorkMin, locale) })}</li> : null}
              {task.validatedAt && (
                <li>
                  {t("taskSheet.validatedAt", {
                    date: `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(task.validatedAt))} ${formatLocalTime(new Date(task.validatedAt), tz, locale)}`,
                  })}
                </li>
              )}
            </ul>
          )}

          {/* Contrôle qualité */}
          {task.status === "done" && !showRedo && (
            <div className="grid grid-cols-2 gap-2">
              <Button size="lg" onClick={() => status("validated", t("taskSheet.validatedToast"))}>
                <Check />
                {t("taskSheet.validate")}
              </Button>
              <Button size="lg" variant="secondary" onClick={() => setShowRedo(true)}>
                <RotateCcw />
                {t("taskSheet.redo")}
              </Button>
            </div>
          )}
          {showRedo && (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (!redoReason.trim()) return;
                updateTask(task.id, { status: "to_redo", notes: redoReason.trim() });
                toast(t("taskSheet.redoToast"));
                setShowRedo(false);
              }}
            >
              <Field label={t("taskSheet.redoReason")} htmlFor="redo">
                <Textarea id="redo" required value={redoReason} onChange={(e) => setRedoReason(e.target.value)} autoFocus />
              </Field>
              <Button type="submit" size="lg" disabled={!redoReason.trim()}>
                {t("taskSheet.sendRedo")}
              </Button>
            </form>
          )}

          {task.notes && task.status !== "done" && (
            <p className="rounded-lg bg-warning-soft p-3 text-[14px] text-fg">{task.notes}</p>
          )}

          {/* Annulation d'une tâche créée à la main */}
          {!task.isAutoGenerated && task.status !== "cancelled" && task.status !== "validated" && (
            <Button
              variant="ghost"
              className="text-danger"
              onClick={() => {
                status("cancelled", t("taskSheet.cancelledToast"));
                onClose();
              }}
            >
              <XCircle />
              {t("taskSheet.cancelTask")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
