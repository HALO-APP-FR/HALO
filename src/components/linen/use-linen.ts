"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { LinenLocationId, LinenType } from "@/lib/domain/types";
import { forecastLinen, kitForTask, stockFromMovements } from "@/lib/engine/linen";
import { addDaysToKey, localDateKey } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { byId, taskDayKey } from "@/lib/store/selectors";

/** Nom affiché d'un article (traduit pour le catalogue HALO, libre sinon). */
export function useLinenName() {
  const t = useTranslations();
  return (type: LinenType | undefined) => (!type ? "—" : type.key ? t(`linenItem.${type.key}`) : type.name);
}

export function useMoney() {
  const locale = useLocale();
  const currency = useHalo((s) => s.linenSettings.currency);
  return (v: number) => new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 2 }).format(v);
}

export function useLocationName() {
  const t = useTranslations();
  const properties = useHalo((s) => s.properties);
  return (loc: LinenLocationId | undefined) => {
    if (!loc) return t("linen.loc_outside");
    if (loc.startsWith("property:")) return properties.find((p) => `property:${p.id}` === loc)?.name ?? t("linen.loc_property");
    return t(`linen.loc_${loc}`);
  };
}

/** Données dérivées du module linge (stock, prévision, besoins). */
export function useLinenData(horizonDays = 7) {
  const types = useHalo((s) => s.linenTypes);
  const movements = useHalo((s) => s.linenMovements);
  const orders = useHalo((s) => s.laundryOrders);
  const tasks = useHalo((s) => s.tasks);
  const properties = useHalo((s) => s.properties);
  const orgTz = useHalo((s) => s.org.timezone);
  const settings = useHalo((s) => s.linenSettings);

  return useMemo(() => {
    const stock = stockFromMovements(movements);
    const props = byId(properties);
    const todayKey = localDateKey(new Date(), orgTz);
    const lastKey = addDaysToKey(todayKey, horizonDays - 1);
    const upcoming = tasks
      .filter((x) => x.type === "turnover" && ["unassigned", "assigned", "in_progress", "to_redo"].includes(x.status))
      .map((x) => {
        const p = props.get(x.propertyId);
        return p ? { task: x, property: p, dayKey: taskDayKey(x, p), kit: kitForTask(x, p, types) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => Boolean(x && x.dayKey >= todayKey && x.dayKey <= lastKey));
    // Retour de blanchisserie : le plus tôt des bons envoyés
    const sent = orders.filter((o) => o.status === "sent" && o.expectedAt);
    const laundryReturnKey = sent.length ? sent.map((o) => localDateKey(new Date(o.expectedAt!), orgTz)).sort()[0] : undefined;
    const forecast = forecastLinen({ tasks: upcoming, types, stock, todayKey, days: horizonDays, laundryReturnKey });
    return { stock, upcoming, forecast, todayKey, laundryReturnKey, types, settings, orders };
  }, [movements, properties, orgTz, horizonDays, tasks, types, orders, settings]);
}
