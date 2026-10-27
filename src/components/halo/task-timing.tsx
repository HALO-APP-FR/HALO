"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Task } from "@/lib/domain/types";
import { formatDuration } from "@/lib/engine/learning";
import { formatLocalRange } from "@/lib/engine/time";
import { cn } from "@/lib/utils";

/**
 * Trois notions à ne jamais confondre :
 * - fenêtre d'intervention : du départ à l'arrivée suivante, quand la mission PEUT être faite ;
 * - durée estimée : le temps de travail ;
 * - créneau planifié : début attribué + durée, ce que l'agent fait réellement (et ce qui crée les conflits).
 */
export function useTaskTiming() {
  const locale = useLocale();
  return {
    window: (task: Task, tz: string) => formatLocalRange(new Date(task.windowStart), new Date(task.windowEnd), tz, locale),
    slot: (task: Task, tz: string) => {
      if (!task.scheduledStart) return null;
      const start = new Date(task.scheduledStart);
      return formatLocalRange(start, new Date(start.getTime() + task.durationMin * 60_000), tz, locale);
    },
    duration: (task: Task) => formatDuration(task.durationMin, locale),
  };
}

/** Cellule « créneau / fenêtre » des tableaux (accueil, liste des tâches). */
export function TaskTimingCell({ task, tz, className }: { task: Task; tz: string; className?: string }) {
  const t = useTranslations("timing");
  const timing = useTaskTiming();
  const slot = timing.slot(task, tz);
  return (
    <span className={cn("block", className)}>
      {slot ? (
        <>
          <span className="block text-[14px] font-semibold tabular">{slot}</span>
          <span className="block text-caption text-muted tabular">{t("windowShort", { range: timing.window(task, tz) })}</span>
        </>
      ) : (
        <>
          <span className="block text-[14px] font-semibold tabular">{t("windowShort", { range: timing.window(task, tz) })}</span>
          <span className="block text-caption text-muted tabular">{t("toPlan", { duration: timing.duration(task) })}</span>
        </>
      )}
    </span>
  );
}
