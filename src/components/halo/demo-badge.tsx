"use client";

import { useTranslations } from "next-intl";
import { FlaskConical } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Rappel permanent du mode démonstration : les données restent dans ce navigateur,
 * sans sauvegarde en ligne ni partage entre appareils.
 */
export function DemoBadge({ variant = "pill", className }: { variant?: "pill" | "row" | "icon"; className?: string }) {
  const t = useTranslations("demo");
  return (
    <Link
      href="/settings"
      title={t("tooltip")}
      aria-label={`${t("badge")} — ${t("tooltip")}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full bg-warning-soft font-semibold text-warning transition-opacity hover:opacity-80",
        variant === "pill" && "h-7 px-2.5 text-[12px]",
        variant === "row" && "w-full rounded-md px-3 py-2 text-[12px] leading-4",
        variant === "icon" && "grid size-10 place-items-center rounded-md",
        className,
      )}
    >
      <FlaskConical className="size-3.5 shrink-0" strokeWidth={2.2} />
      {variant === "pill" && t("badge")}
      {variant === "row" && (
        <span>
          {t("badge")}
          <span className="block font-normal opacity-90">{t("short")}</span>
        </span>
      )}
    </Link>
  );
}
