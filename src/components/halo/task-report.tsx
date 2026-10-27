"use client";

import { useLocale, useTranslations } from "next-intl";
import { CircleCheck, Hammer, MessageSquareText, PackageX, SprayCan, Timer, type LucideIcon } from "lucide-react";
import type { Property, RoomStatus, Task } from "@/lib/domain/types";
import { actualMinutes, formatDuration } from "@/lib/engine/learning";
import { PhotoThumb } from "./photo-thumb";
import { cn } from "@/lib/utils";

export const ROOM_STATUS_META: Record<RoomStatus, { icon: LucideIcon; on: string; text: string }> = {
  ok: { icon: CircleCheck, on: "border-success bg-success text-white", text: "text-success" },
  damage: { icon: Hammer, on: "border-danger bg-danger text-white", text: "text-danger" },
  missing: { icon: PackageX, on: "border-warning bg-warning text-white dark:text-black", text: "text-warning" },
  dirty: { icon: SprayCan, on: "border-info bg-info text-white", text: "text-info" },
  other: { icon: MessageSquareText, on: "border-fg bg-fg text-canvas", text: "text-fg" },
};
export const ROOM_STATUSES = Object.keys(ROOM_STATUS_META) as RoomStatus[];

/** Temps réel vs prévu : « 1 h 52 · prévu 2 h 30 ». */
export function DurationCompare({ task, className }: { task: Task; className?: string }) {
  const t = useTranslations("mission");
  const locale = useLocale();
  const real = actualMinutes(task);
  if (real === null) return null;
  const gap = Math.round(((real - task.durationMin) / task.durationMin) * 100);
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 text-[14px]", className)}>
      <Timer className="size-4 text-muted" aria-hidden />
      <span className="font-semibold tabular">{t("realTime", { time: formatDuration(real, locale) })}</span>
      <span className="text-muted">{t("plannedTime", { time: formatDuration(task.durationMin, locale) })}</span>
      <span className={cn("font-semibold tabular", gap > 10 ? "text-warning" : "text-success")}>{gap > 0 ? `+${gap}` : gap} %</span>
    </p>
  );
}

/** Rapport de l'agent, lu par le manager : état de chaque pièce, commentaires, photos. */
export function TaskReportView({ task, property }: { task: Task; property: Property }) {
  const t = useTranslations();
  const report = task.report;
  if (!report && !task.completedAt) return null;
  const items = property.checklist.flatMap((r) => r.items);
  const checked = report?.checked.filter((id) => items.some((i) => i.id === id)).length ?? 0;
  const photos = Object.values(report?.photos ?? {}).flat();

  return (
    <section className="space-y-3">
      <h3 className="text-micro text-muted">{t("mission.report")}</h3>
      <DurationCompare task={task} />
      {items.length > 0 && <p className="text-[14px] text-muted">{t("mission.checkedCount", { done: checked, total: items.length })}</p>}
      <ul className="divide-y divide-line rounded-lg border border-line">
        {property.checklist.map((room) => {
          const r = report?.rooms[room.id];
          const status = r?.status;
          const meta = status ? ROOM_STATUS_META[status] : null;
          const Icon = meta?.icon;
          return (
            <li key={room.id} className="px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[15px] font-medium">{room.name}</span>
                {meta && Icon ? (
                  <span className={cn("inline-flex items-center gap-1 text-[13px] font-semibold", meta.text)}>
                    <Icon className="size-4" />
                    {t(`roomStatus.${status}`)}
                  </span>
                ) : (
                  <span className="text-caption text-faint">—</span>
                )}
              </div>
              {r?.comment && <p className="mt-1 text-[14px] text-muted">« {r.comment} »</p>}
              {r?.photoIds && r.photoIds.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.photoIds.map((id) => (
                    <PhotoThumb key={id} id={id} size="sm" />
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {photos.length > 0 && (
        <div>
          <p className="mb-2 text-caption text-muted">{t("mission.photosTaken", { count: photos.length })}</p>
          <div className="flex flex-wrap gap-1.5">
            {photos.map((id) => (
              <PhotoThumb key={id} id={id} size="md" />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
