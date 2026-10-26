import { useTranslations } from "next-intl";
import { Baby, PawPrint, Users } from "lucide-react";
import { cn } from "@/lib/utils";

/** Composition du séjour : voyageurs, bébés, animaux — l'info qui change la préparation. */
export function GuestBadges({
  guests,
  babies,
  pets,
  size = "md",
  className,
}: {
  guests?: number;
  babies?: number;
  pets?: number;
  size?: "sm" | "md";
  className?: string;
}) {
  const t = useTranslations();
  const text = size === "sm" ? "text-caption" : "text-[15px]";
  const icon = size === "sm" ? "size-3.5" : "size-4";
  if (!guests && !babies && !pets) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-muted", text, className)}>
      {guests ? (
        <span className="inline-flex items-center gap-1" title={t("task.guests", { count: guests })}>
          <Users className={icon} strokeWidth={1.9} aria-hidden />
          <span className="sr-only">{t("task.guests", { count: guests })}</span>
          <span aria-hidden>{guests}</span>
        </span>
      ) : null}
      {babies ? (
        <span className="inline-flex items-center gap-1 font-medium text-info" title={t("guests.babies", { count: babies })}>
          <Baby className={icon} strokeWidth={2} aria-hidden />
          {t("guests.babies", { count: babies })}
        </span>
      ) : null}
      {pets ? (
        <span className="inline-flex items-center gap-1 font-medium text-warning" title={t("guests.pets", { count: pets })}>
          <PawPrint className={icon} strokeWidth={2} aria-hidden />
          {t("guests.pets", { count: pets })}
        </span>
      ) : null}
    </span>
  );
}
