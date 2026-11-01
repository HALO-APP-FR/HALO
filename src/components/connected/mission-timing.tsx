import { getFormatter, getTranslations } from "next-intl/server";
import { durationText } from "@/lib/connected/format";

/**
 * Quatre informations distinctes, jamais confondues :
 *  - échéance (fin de la fenêtre : prochaine arrivée ou fin choisie) ;
 *  - disponibilité (début de la fenêtre : départ précédent) ;
 *  - durée prévue du travail (estimation) ;
 *  - créneau planifié, s'il existe.
 */
export async function MissionTiming({
  task,
  timeZone,
  compact = false,
  assignee,
}: {
  task: { window_start: string; window_end: string; duration_min: number; scheduled_start: string | null; status: string };
  timeZone?: string;
  compact?: boolean;
  assignee?: string | null;
}) {
  const t = await getTranslations("connected.timing");
  const f = await getFormatter();
  const tz = timeZone ? { timeZone } : {};
  const at = (x: string) => f.dateTime(new Date(x), { weekday: compact ? undefined : "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...tz });
  const slotEnd = task.scheduled_start ? new Date(Date.parse(task.scheduled_start) + task.duration_min * 60_000).toISOString() : null;
  const open = !["done", "validated", "cancelled"].includes(task.status);
  if (compact)
    return (
      <span className="block text-[13px] text-muted" data-testid="mission-timing-compact">
        <span className="text-fg">{t("before", { date: at(task.window_end) })}</span> · {t("durationShort", { duration: durationText(task.duration_min) })} ·{" "}
        {task.scheduled_start ? t("slotShort", { start: at(task.scheduled_start) }) : open ? t("noSlot") : t("from", { date: at(task.window_start) })}
      </span>
    );
  return (
    <dl className="grid gap-x-6 gap-y-2 text-[15px] sm:grid-cols-2" data-testid="mission-timing-detail">
      <div>
        <dt className="text-[13px] font-medium text-muted">{t("deadlineLabel")}</dt>
        <dd data-testid="mission-deadline">{at(task.window_end)}</dd>
      </div>
      <div>
        <dt className="text-[13px] font-medium text-muted">{t("fromLabel")}</dt>
        <dd data-testid="mission-from">{at(task.window_start)}</dd>
      </div>
      <div>
        <dt className="text-[13px] font-medium text-muted">{t("durationLabel")}</dt>
        <dd data-testid="mission-duration">
          {durationText(task.duration_min)} <span className="text-[13px] text-muted">({t("estimate")})</span>
        </dd>
      </div>
      <div>
        <dt className="text-[13px] font-medium text-muted">{t("slotLabel")}</dt>
        <dd data-testid="mission-slot">{task.scheduled_start && slotEnd ? `${at(task.scheduled_start)} → ${f.dateTime(new Date(slotEnd), { hour: "2-digit", minute: "2-digit", ...tz })}` : t("noSlotLong")}</dd>
      </div>
      {assignee !== undefined && (
        <div>
          <dt className="text-[13px] font-medium text-muted">{t("assigneeLabel")}</dt>
          <dd data-testid="mission-assignee">{assignee ?? t("unassigned")}</dd>
        </div>
      )}
    </dl>
  );
}
