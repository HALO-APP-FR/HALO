"use client";

import { useLocale, useTranslations } from "next-intl";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Navigation jour par jour : ‹ Aujourd'hui ›. dayKey au format AAAA-MM-JJ. */
export function DayNav({
  dayKey,
  todayKey,
  onChange,
  step = 1,
}: {
  dayKey: string;
  todayKey: string;
  onChange: (delta: number | "today") => void;
  step?: number;
}) {
  const t = useTranslations("common");
  const locale = useLocale();
  const label = new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${dayKey}T12:00:00Z`),
  );
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="icon" onClick={() => onChange(-step)} aria-label={t("previous")}>
        <ChevronLeft className="rtl:-scale-x-100" />
      </Button>
      <Button variant={dayKey === todayKey ? "secondary" : "outline"} size="sm" onClick={() => onChange("today")} disabled={dayKey === todayKey}>
        {t("today")}
      </Button>
      <Button variant="ghost" size="icon" onClick={() => onChange(step)} aria-label={t("next")}>
        <ChevronRight className="rtl:-scale-x-100" />
      </Button>
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </div>
  );
}
