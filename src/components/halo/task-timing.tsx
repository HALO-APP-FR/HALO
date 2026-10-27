"use client";

import { useLocale, useTranslations } from "next-intl";
import type { Task } from "@/lib/domain/types";
import { formatDuration } from "@/lib/engine/learning";
import { formatLocalRange, formatLocalTime, localDateKey } from "@/lib/engine/time";
import { taskAnchor } from "@/lib/store/selectors";
import { infeasibility, windowShortfallMin } from "@/lib/engine/conflicts";
import { Badge } from "@/components/ui/badge";
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
    // Référence = jour où la mission est affichée : un début d'une autre date est daté
    window: (task: Task, tz: string) =>
      formatLocalRange(new Date(task.windowStart), new Date(task.windowEnd), tz, locale, localDateKey(new Date(taskAnchor(task)), tz)),
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

/** Repère d'impossibilité : fenêtre trop courte, en retard, ou plus assez de temps. */
export function FeasibilityBadge({ task, className }: { task: Task; className?: string }) {
  const t = useTranslations("feasibility");
  const locale = useLocale();
  const why = infeasibility(task, new Date());
  if (!why) return null;
  const label =
    why === "window_too_short"
      ? t("tooShortBadge", { missing: formatDuration(windowShortfallMin(task), locale) })
      : why === "window_passed"
        ? t("overdueBadge")
        : t("tooLateBadge");
  return (
    <Badge tone={why === "too_late_today" ? "warning" : "danger"} className={className}>
      {label}
    </Badge>
  );
}

/**
 * Explication avant affectation : pourquoi la mission ne peut pas être faite dans sa fenêtre,
 * et les décisions possibles (aucune solution n'est appliquée automatiquement).
 */
export function FeasibilityExplain({ task, tz }: { task: Task; tz: string }) {
  const t = useTranslations("feasibility");
  const locale = useLocale();
  const now = new Date();
  const why = infeasibility(task, now);
  if (!why) return null;
  const windowMin = Math.round((new Date(task.windowEnd).getTime() - new Date(task.windowStart).getTime()) / 60_000);
  const leftMin = Math.max(0, Math.round((new Date(task.windowEnd).getTime() - Math.max(now.getTime(), new Date(task.windowStart).getTime())) / 60_000));
  const end = `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric" }).format(new Date(task.windowEnd))} ${formatLocalTime(new Date(task.windowEnd), tz, locale)}`;
  const d = (m: number) => formatDuration(m, locale);
  return (
    <div role="alert" className={cn("rounded-lg p-4 text-[14px]", why === "too_late_today" ? "bg-warning-soft" : "bg-danger-soft")}>
      <p className={cn("text-[15px] font-semibold", why === "too_late_today" ? "text-warning" : "text-danger")}>{t(`${why}Title`)}</p>
      <p className="mt-1">
        {why === "window_too_short"
          ? t("tooShortText", { duration: d(task.durationMin), window: d(windowMin), missing: d(windowShortfallMin(task)) })
          : why === "window_passed"
            ? t("passedText", { end })
            : t("tooLateText", { left: d(leftMin), duration: d(task.durationMin), end })}
      </p>
      <p className="mt-2 font-medium">{t("options")}</p>
      <ul className="mt-1 list-disc space-y-0.5 ps-5">
        {(why === "window_passed" ? ["optCheck", "optTellGuest", "optManager"] : ["optDuration", "optStay", "optManager"]).map((k) => (
          <li key={k}>{t(k)}</li>
        ))}
      </ul>
      {why !== "window_passed" && <p className="mt-2 text-caption">{t("assignRisk")}</p>}
    </div>
  );
}
