"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Baby, Check, ChevronRight, KeyRound, Navigation, PawPrint, Siren } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { Property, Task } from "@/lib/domain/types";
import { formatLocalTime, isSameLocalDay } from "@/lib/engine/time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TaskLinenKit } from "@/components/linen/task-linen-kit";
import { GuestBadges } from "./guest-badges";
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
  onReport,
  href,
}: {
  task: Task;
  property: Property;
  /** Jour de référence pour l'heure limite (aujourd'hui, ou le jour de la section). */
  reference: Date;
  onStart?: () => void;
  onFinish?: () => void;
  /** Signaler un problème (visible pendant la mission). */
  onReport?: () => void;
  /** Écran de la mission (toute la carte devient cliquable). */
  href?: string;
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

        <h3 className="mt-4 text-[22px] font-semibold leading-7 tracking-[-0.01em]">
          {href ? (
            <Link href={href} className="flex items-center justify-between gap-2 after:absolute after:inset-0 after:content-['']">
              {property.name}
              <ChevronRight className="size-5 shrink-0 text-faint rtl:-scale-x-100" aria-hidden />
            </Link>
          ) : (
            property.name
          )}
        </h3>
        <p className="mt-0.5 text-[15px] text-muted">{[property.area, property.city].filter(Boolean).join(" · ")}</p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          <time className="text-[19px] font-semibold tabular">{deadline}</time>
          <GuestBadges guests={task.guestsCount} vip={task.vip} />
        </div>

        {/* Préparation spécifique : bébé, animaux */}
        {(task.babies || task.pets) && task.type === "turnover" ? (
          <ul className="mt-3 space-y-1.5">
            {task.babies ? (
              <li className="flex items-center gap-2 rounded-md bg-info-soft px-3 py-2 text-[15px] font-medium text-info">
                <Baby className="size-4 shrink-0" />
                {t("guests.prepareBaby", { count: task.babies })}
              </li>
            ) : null}
            {task.pets ? (
              <li className="flex items-center gap-2 rounded-md bg-warning-soft px-3 py-2 text-[15px] font-medium text-warning">
                <PawPrint className="size-4 shrink-0" />
                {t("guests.petsCleaning")}
              </li>
            ) : null}
          </ul>
        ) : null}

        {!finished && <TaskLinenKit task={task} property={property} className="mt-3" />}

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
          <div className="relative z-10 mt-5 flex gap-2">
            {started && href ? (
              <Button asChild size="xl" className="flex-1">
                <Link href={href}>
                  {t("mission.continue")}
                  <ArrowRight className="rtl:-scale-x-100" />
                </Link>
              </Button>
            ) : started ? (
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
        {onReport && started && (
          <Button variant="ghost" className="relative z-10 mt-2 w-full text-danger" onClick={onReport}>
            <Siren />
            {t("alerts.report")}
          </Button>
        )}
      </div>
    </article>
  );
}
