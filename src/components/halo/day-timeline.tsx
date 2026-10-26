import { useLocale, useTranslations } from "next-intl";
import type { DemoAgent, DemoProperty, DemoTask } from "@/lib/demo/data";
import { formatLocalTime, isSameLocalDay, localMinutesOfDay } from "@/lib/engine/time";
import { Avatar } from "./avatar";
import { StatusPill } from "./status-pill";
import { TASK_TYPE_META, TaskTypeIcon } from "./task-type";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const DAY_START = 8 * 60; // 08:00
const DAY_END = 20 * 60; // 20:00
const SPAN = DAY_END - DAY_START;
const HOURS = [8, 10, 12, 14, 16, 18, 20];

function pct(minutes: number) {
  return `${(Math.min(Math.max(minutes - DAY_START, 0), SPAN) / SPAN) * 100}%`;
}

/**
 * Timeline du jour (manager) : une ligne par mission.
 * La barre claire = fenêtre disponible (départ → arrivée), le bloc plein = créneau planifié.
 * Tout est positionné à l'heure LOCALE du logement.
 */
export function DayTimeline({
  tasks,
  properties,
  agents,
  now,
}: {
  tasks: DemoTask[];
  properties: DemoProperty[];
  agents: DemoAgent[];
  now: Date;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const sorted = [...tasks].sort((a, b) => a.windowStart.getTime() - b.windowStart.getTime());
  const defaultTz = properties[0]?.timezone ?? "UTC";
  const nowMin = localMinutesOfDay(now, defaultTz);
  const showNow = nowMin > DAY_START && nowMin < DAY_END;

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[760px]">
        {/* Axe des heures */}
        <div className="grid grid-cols-[264px_1fr] border-b border-line pb-2">
          <span />
          <div className="relative h-4">
            {HOURS.map((h) => (
              <span
                key={h}
                className={cn(
                  "absolute text-caption text-muted tabular",
                  h === HOURS[HOURS.length - 1] ? "-translate-x-full rtl:translate-x-full" : "-translate-x-1/2 rtl:translate-x-1/2",
                )}
                style={{ insetInlineStart: pct(h * 60) }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>
        </div>

        <ul>
          {sorted.map((task) => {
            const property = properties.find((p) => p.id === task.propertyId)!;
            const agent = agents.find((a) => a.id === task.assigneeId);
            const tz = property.timezone;
            const startMin = localMinutesOfDay(task.windowStart, tz);
            const endMin = isSameLocalDay(task.windowEnd, task.windowStart, tz)
              ? localMinutesOfDay(task.windowEnd, tz)
              : DAY_END + 60;
            const plannedStart = task.scheduledStart ? localMinutesOfDay(task.scheduledStart, tz) : null;
            const meta = TASK_TYPE_META[task.type];
            const isOtherTz = tz !== defaultTz;

            return (
              <li
                key={task.id}
                className="grid grid-cols-[264px_1fr] items-center border-b border-line py-3 transition-colors last:border-b-0 hover:bg-surface-hover"
              >
                <div className="flex min-w-0 items-center gap-3 pe-4">
                  <TaskTypeIcon type={task.type} size="sm" />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[14px] font-semibold">{property.name}</span>
                      {task.priority !== "normal" && (
                        <Badge tone="danger" className="px-1.5">
                          {t(`priority.${task.priority}`)}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-caption text-muted">
                      <span>{t(`taskType.${task.type}`)}</span>
                      <span aria-hidden>·</span>
                      <StatusPill status={task.status} />
                      {isOtherTz && <span>· {property.city}</span>}
                    </div>
                  </div>
                </div>

                <div className="relative h-9">
                  {HOURS.map((h) => (
                    <span
                      key={h}
                      className="absolute inset-y-0 w-px bg-line/70"
                      style={{ insetInlineStart: pct(h * 60) }}
                      aria-hidden
                    />
                  ))}
                  {showNow && (
                    <span className="absolute inset-y-[-6px] z-10 w-px bg-danger" style={{ insetInlineStart: pct(nowMin) }} aria-hidden />
                  )}
                  {/* Fenêtre disponible */}
                  <div
                    className={cn(
                      "absolute inset-y-1.5 rounded-full",
                      task.status === "unassigned" ? "bg-danger-soft ring-1 ring-danger/30 ring-inset" : "bg-subtle dark:bg-surface-hover",
                    )}
                    style={{ insetInlineStart: pct(startMin), width: `calc(${pct(endMin)} - ${pct(startMin)})` }}
                    title={`${formatLocalTime(task.windowStart, tz, locale)} → ${formatLocalTime(task.windowEnd, tz, locale)}`}
                  />
                  {/* Créneau planifié */}
                  {plannedStart !== null && (
                    <div
                      className={cn("absolute inset-y-1.5 flex items-center rounded-full ps-1", meta.bar)}
                      style={{
                        insetInlineStart: pct(plannedStart),
                        width: `calc(${pct(plannedStart + task.durationMin)} - ${pct(plannedStart)})`,
                      }}
                    >
                      {agent && <Avatar initials={agent.initials} color={agent.color} size="sm" className="ring-0" label={agent.name} />}
                    </div>
                  )}
                  <span
                    className="absolute top-1/2 -translate-y-1/2 ps-2 text-caption text-muted tabular"
                    style={{ insetInlineStart: endMin > DAY_END ? "100%" : pct(endMin) }}
                  >
                    {endMin <= DAY_END && formatLocalTime(task.windowEnd, tz, locale)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
