"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, History } from "lucide-react";
import type { Property, Task } from "@/lib/domain/types";
import { formatLocalTime } from "@/lib/engine/time";
import { TaskReportView } from "./task-report";
import { cn } from "@/lib/utils";

function useStamp(tz: string) {
  const locale = useLocale();
  return (iso: string) =>
    `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso))} ${formatLocalTime(new Date(iso), tz, locale)}`;
}

/** Historique des étapes importantes : qui, quoi, quand. */
export function TaskHistory({ task, tz }: { task: Task; tz: string }) {
  const t = useTranslations();
  const stamp = useStamp(tz);
  const events = task.events ?? [];
  // Missions antérieures à l'historique : on affiche au moins la validation connue
  if (events.length === 0) {
    return task.validatedAt ? <p className="text-caption text-muted">{t("taskSheet.validatedAt", { date: stamp(task.validatedAt) })}</p> : null;
  }
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-micro text-muted">
        <History className="size-3.5" />
        {t("cycle.history")}
      </h3>
      <ol className="space-y-2 border-s border-line ps-3">
        {events.map((e, i) => (
          <li key={i} className="text-[14px]">
            <span className="font-medium">{t(`cycle.event.${e.kind}`)}</span>
            <span className="text-muted">
              {" · "}
              {stamp(e.at)}
              {e.by ? ` · ${e.by}` : ""}
            </span>
            {e.note && <span className="mt-0.5 block text-muted">« {e.note} »</span>}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Comptes rendus renvoyés en correction : conservés tels qu'ils ont été soumis. */
export function ArchivedReports({ task, property }: { task: Task; property: Property }) {
  const t = useTranslations();
  const stamp = useStamp(property.timezone);
  const [open, setOpen] = useState<number | null>(null);
  const list = task.reportHistory ?? [];
  if (list.length === 0) return null;
  return (
    <section className="space-y-2">
      {list.map((a, i) => (
        <div key={a.archivedAt} className="rounded-lg border border-line">
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-between gap-2 px-3 text-start text-[14px] font-medium"
            aria-expanded={open === i}
            onClick={() => setOpen(open === i ? null : i)}
          >
            {t("cycle.archivedReport", { n: i + 1, date: a.completedAt ? stamp(a.completedAt) : "—" })}
            <ChevronDown className={cn("size-4 text-muted transition-transform", open === i && "rotate-180")} />
          </button>
          {open === i && (
            <div className="border-t border-line p-3">
              <TaskReportView task={{ ...task, report: a.report, startedAt: a.startedAt, completedAt: a.completedAt, previousWorkMin: 0 }} property={property} />
            </div>
          )}
        </div>
      ))}
    </section>
  );
}
