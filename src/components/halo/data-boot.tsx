"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";
import { useHalo } from "@/lib/store/halo-store";

/**
 * Charge les données enregistrées dans le navigateur, crée la démo à la première visite,
 * puis recalcule les tâches (les réservations du jour génèrent leurs ménages).
 */
export function DataBoot() {
  const locale = useLocale();
  useEffect(() => {
    let cancelled = false;
    Promise.resolve(useHalo.persist.rehydrate()).then(() => {
      if (cancelled) return;
      const s = useHalo.getState();
      s.ensureSeeded(locale);
      s.refreshTasks();
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);
  return null;
}
