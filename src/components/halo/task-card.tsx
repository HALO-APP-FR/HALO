import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Navigation, Users } from "lucide-react";
import type { DemoProperty, DemoTask } from "@/lib/demo/data";
import { formatLocalTime, isSameLocalDay } from "@/lib/engine/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "./status-pill";
import { TASK_TYPE_META, TaskTypeIcon } from "./task-type";
import { cn } from "@/lib/utils";

/** Libellé de l'heure limite : « Avant 15:00 », ou avec le jour si ce n'est pas aujourd'hui. */
export function useDeadlineLabel() {
  const t = useTranslations("task");
  const locale = useLocale();
  return (task: DemoTask, property: DemoProperty, now: Date) => {
    const time = formatLocalTime(task.windowEnd, property.timezone, locale);
    if (isSameLocalDay(task.windowEnd, now, property.timezone)) return t("before", { time });
    const day = new Intl.DateTimeFormat(locale, { timeZone: property.timezone, weekday: "short" }).format(task.windowEnd);
    return t("before", { time: `${day} ${time}` });
  };
}

/** Carte de mission côté agent : lisible en 3 secondes, utilisable d'une main. */
export function TaskCard({
  task,
  property,
  now,
  showAction = true,
}: {
  task: DemoTask;
  property: DemoProperty;
  now: Date;
  showAction?: boolean;
}) {
  const t = useTranslations();
  const deadline = useDeadlineLabel()(task, property, now);
  const meta = TASK_TYPE_META[task.type];
  const started = task.status === "in_progress";
  const finished = task.status === "done" || task.status === "validated";
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${property.name}, ${property.area}, ${property.city}`)}`;

  return (
    <article
      className={cn(
        "relative overflow-hidden rounded-xl border border-line bg-surface shadow-card",
        finished && "opacity-60",
      )}
    >
      <span className={cn("absolute inset-y-0 start-0 w-1", meta.bar)} aria-hidden />
      <div className="p-5 ps-6">
        <div className="flex items-center justify-between gap-3">
          <span className={cn("flex items-center gap-2 text-[15px] font-semibold", meta.text)}>
            <TaskTypeIcon type={task.type} size="sm" />
            {t(`taskType.${task.type}`)}
          </span>
          <div className="flex items-center gap-2">
            {task.priority === "urgent" && <Badge tone="danger">{t("priority.urgent")}</Badge>}
            {task.priority === "high" && <Badge tone="danger">{t("priority.high")}</Badge>}
            {task.status !== "assigned" && <StatusPill status={task.status} />}
          </div>
        </div>

        <h3 className="mt-4 text-[22px] font-semibold leading-7 tracking-[-0.01em]">{property.name}</h3>
        <p className="mt-0.5 text-[15px] text-muted">
          {property.area} · {property.city}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <time className="text-[19px] font-semibold tabular">{deadline}</time>
          {task.guests ? (
            <span className="flex items-center gap-1.5 text-[15px] text-muted">
              <Users className="size-4" strokeWidth={1.9} />
              {t("task.guests", { count: task.guests })}
            </span>
          ) : null}
        </div>

        {showAction && !finished && (
          <div className="mt-5 flex gap-2">
            <Button size="xl" className="flex-1">
              {started ? t("task.resume") : t("task.start")}
              <ArrowRight />
            </Button>
            <Button asChild size="xl" variant="secondary" className="w-14 flex-none px-0">
              <a href={directions} target="_blank" rel="noreferrer" aria-label={t("task.directions")}>
                <Navigation />
              </a>
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
