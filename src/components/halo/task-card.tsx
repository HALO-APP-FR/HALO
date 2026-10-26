"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check, KeyRound, Navigation, Users } from "lucide-react";
import type { Property, Task } from "@/lib/domain/types";
import { formatLocalTime, isSameLocalDay } from "@/lib/engine/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusPill } from "./status-pill";
import { TASK_TYPE_META, TaskTypeIcon } from "./task-type";
import { cn } from "@/lib/utils";

/** « Avant 15:00 », avec le jour seulement si ce n'est pas le jour de référence. */
export function useDeadlineLabel() {
  const t = useTranslations("task");
  const locale = useLocale();
  return (task: Task, property: Property, reference: Date) => {
    const end = new Date(task.windowEnd);
    const time = formatLocalTime(end, property.timezone, locale);
    if (isSameLocalDay(end, reference, property.timezone)) return t("before", { time });
    const day = new Intl.DateTimeFormat(locale, { timeZone: property.timezone, weekday: "short" }).format(end);
    return t("before", { time: `${day} ${time}` });
  };
}

export function directionsUrl(property: Property) {
  const q = [property.addressLine, property.postalCode, property.city].filter(Boolean).join(", ") || property.name;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}

/** Carte de mission côté agent : lisible en 3 secondes, utilisable d'une main. */
export function TaskCard({
  task,
  property,
  reference,
  onStart,
  onFinish,
}: {
  task: Task;
  property: Property;
  /** Jour de référence pour l'heure limite (aujourd'hui, ou le jour de la section). */
  reference: Date;
  onStart?: () => void;
  onFinish?: () => void;
}) {
  const t = useTranslations();
  const deadline = useDeadlineLabel()(task, property, reference);
  const meta = TASK_TYPE_META[task.type];
  const started = task.status === "in_progress";
  const finished = task.status === "done" || task.status === "validated";
  const canAct = Boolean(onStart || onFinish) && !finished;

  return (
    <article className={cn("relative overflow-hidden rounded-xl border border-line bg-surface shadow-card", finished && "opacity-60")}>
      <span className={cn("absolute inset-y-0 start-0 w-1", meta.bar)} aria-hidden />
      <div className="p-5 ps-6">
        <div className="flex items-center justify-between gap-3">
          <span className={cn("flex items-center gap-2 text-[15px] font-semibold", meta.text)}>
            <TaskTypeIcon type={task.type} size="sm" />
            {t(`taskType.${task.type}`)}
          </span>
          <div className="flex items-center gap-2">
            {task.priority !== "normal" && <Badge tone="danger">{t(`priority.${task.priority}`)}</Badge>}
            {task.status !== "assigned" && <StatusPill status={task.status} />}
          </div>
        </div>

        <h3 className="mt-4 text-[22px] font-semibold leading-7 tracking-[-0.01em]">{property.name}</h3>
        <p className="mt-0.5 text-[15px] text-muted">{[property.area, property.city].filter(Boolean).join(" · ")}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <time className="text-[19px] font-semibold tabular">{deadline}</time>
          {task.guestsCount ? (
            <span className="flex items-center gap-1.5 text-[15px] text-muted">
              <Users className="size-4" strokeWidth={1.9} />
              {t("task.guests", { count: task.guestsCount })}
            </span>
          ) : null}
        </div>

        {/* Accès : visible uniquement pendant la mission */}
        {started && property.access.type !== "in_person" && (
          <div className="mt-4 flex items-center gap-3 rounded-lg bg-subtle px-4 py-3 dark:bg-surface-hover">
            <KeyRound className="size-5 shrink-0 text-muted" strokeWidth={1.9} />
            <div className="min-w-0">
              <div className="text-caption text-muted">{t(`access.${property.access.type}`)}</div>
              {property.access.code && <div className="text-[26px] font-bold tracking-[0.2em] tabular">{property.access.code}</div>}
              {property.access.instructions && <div className="text-[15px]">{property.access.instructions}</div>}
            </div>
          </div>
        )}

        {canAct && (
          <div className="mt-5 flex gap-2">
            {started ? (
              <Button size="xl" className="flex-1 bg-success hover:bg-success hover:opacity-90" onClick={onFinish}>
                <Check />
                {t("task.finish")}
              </Button>
            ) : (
              <Button size="xl" className="flex-1" onClick={onStart}>
                {task.status === "to_redo" ? t("task.resume") : t("task.start")}
                <ArrowRight className="rtl:-scale-x-100" />
              </Button>
            )}
            <Button asChild size="xl" variant="secondary" className="w-14 flex-none px-0">
              <a href={directionsUrl(property)} target="_blank" rel="noreferrer" aria-label={t("task.directions")}>
                <Navigation />
              </a>
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}
