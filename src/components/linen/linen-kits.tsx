"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Baby, Building2 } from "lucide-react";
import { kitCost, kitFor, kitForTask, qtyAt } from "@/lib/engine/linen";
import { formatLocalTime } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/halo/empty-state";
import { GuestBadges } from "@/components/halo/guest-badges";
import { Stepper } from "@/components/halo/property-create-sheet";
import { useLinenData, useLinenName, useMoney } from "./use-linen";

/** Kits de linge par logement : composition, coût d'une rotation, prochaine rotation, niveau de stock. */
export function LinenKits() {
  const t = useTranslations();
  const locale = useLocale();
  const name = useLinenName();
  const money = useMoney();
  const allProperties = useHalo((s) => s.properties);
  const properties = allProperties.filter((p) => !p.archived);
  const { stock, types, upcoming } = useLinenData(14);

  if (properties.length === 0) {
    return (
      <Card>
        <EmptyState icon={Building2} title={t("properties.emptyTitle")} />
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {properties.map((p) => {
        const kit = kitFor(p.beds, types, p.capacity, 0);
        const next = upcoming.filter((u) => u.property.id === p.id).sort((a, b) => a.task.windowStart.localeCompare(b.task.windowStart))[0];
        const nextKit = next ? kitForTask(next.task, p, types) : null;
        const inPlace = types.reduce((n, ty) => n + Math.max(0, qtyAt(stock, `property:${p.id}`, ty.id)), 0);
        return (
          <Card key={p.id} className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="truncate text-title-3">{p.name}</h3>
                <p className="mt-0.5 text-caption text-muted">
                  {t("linen.kitFor", { beds: p.beds.length, guests: p.capacity })} · {t("linen.inPlace", { count: inPlace })}
                </p>
              </div>
              <div className="shrink-0 text-end">
                <span className="block text-title-3 tabular">{money(kitCost(kit, types))}</span>
                <span className="block text-caption text-muted">{t("linen.perRotation")}</span>
              </div>
            </div>
            <ul className="mt-4 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2 text-[14px]">
              {kit.map((l) => (
                <li key={l.linenTypeId} className="flex justify-between gap-2">
                  <span className="truncate text-muted">{name(types.find((x) => x.id === l.linenTypeId))}</span>
                  <span className="font-semibold tabular">×{l.qty}</span>
                </li>
              ))}
            </ul>
            {next && nextKit && (
              <div className="mt-4 rounded-lg bg-subtle p-3 dark:bg-surface-hover">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[14px] font-semibold">
                    {t("linen.nextRotation", {
                      date: `${new Intl.DateTimeFormat(locale, { timeZone: p.timezone, weekday: "short", day: "numeric" }).format(new Date(next.task.windowStart))} ${formatLocalTime(new Date(next.task.windowStart), p.timezone, locale)}`,
                    })}
                  </span>
                  <GuestBadges guests={next.task.guestsCount} babies={next.task.babies} pets={next.task.pets} vip={next.task.vip} size="sm" />
                </div>
                {next.task.babies ? (
                  <p className="mt-1 flex items-center gap-1.5 text-caption text-info">
                    <Baby className="size-3.5" />
                    {t("linen.babyKit")}
                  </p>
                ) : null}
                <p className="mt-1 text-caption text-muted">
                  {nextKit
                    .map((l) => `${l.qty} ${name(types.find((x) => x.id === l.linenTypeId)).toLocaleLowerCase(locale)}`)
                    .join(" · ")}
                </p>
              </div>
            )}
            <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-3">
              <span className="text-[14px]">
                {t("linen.parLevel")}
                <span className="block text-caption text-muted">{t("linen.parLevelHint")}</span>
              </span>
              <Stepper
                label={t("linen.parLevel")}
                value={p.linenParLevel}
                min={2}
                max={6}
                onChange={(v) => {
                  useHalo.getState().updateProperty(p.id, { linenParLevel: v });
                  toast(t("form.saved"));
                }}
              />
            </div>
          </Card>
        );
      })}
    </div>
  );
}
