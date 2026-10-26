"use client";

import { useLocale, useTranslations } from "next-intl";
import { Shirt } from "lucide-react";
import type { Property, Task } from "@/lib/domain/types";
import { kitForTask } from "@/lib/engine/linen";
import { useHalo } from "@/lib/store/halo-store";
import { cn } from "@/lib/utils";
import { useLinenName } from "./use-linen";

/** Linge à apporter pour une rotation : calculé depuis les lits, les voyageurs et les bébés. */
export function TaskLinenKit({ task, property, className }: { task: Task; property: Property; className?: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const name = useLinenName();
  const types = useHalo((s) => s.linenTypes);
  if (task.type !== "turnover") return null;
  const kit = kitForTask(task, property, types);
  if (kit.length === 0) return null;
  const pieces = kit.reduce((n, l) => n + l.qty, 0);
  return (
    <div className={cn("rounded-lg bg-subtle p-3 dark:bg-surface-hover", className)}>
      <p className="flex items-center gap-1.5 text-caption font-semibold text-muted">
        <Shirt className="size-3.5" />
        {t("linen.kitToBring", { count: pieces })}
      </p>
      <ul className="mt-1.5 grid grid-cols-1 gap-x-4 sm:grid-cols-2 gap-y-1 text-[14px]">
        {kit.map((l) => (
          <li key={l.linenTypeId} className="flex justify-between gap-2">
            <span className="truncate">{name(types.find((x) => x.id === l.linenTypeId)).toLocaleLowerCase(locale)}</span>
            <span className="font-semibold tabular">×{l.qty}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
