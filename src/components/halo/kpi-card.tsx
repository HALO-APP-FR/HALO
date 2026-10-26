import type { LucideIcon } from "lucide-react";
import { ChevronRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/**
 * Indicateur cliquable. Téléphone : une ligne compacte (libellé + chiffre).
 * Ordinateur : carte avec grand chiffre. Ouvre le détail (lien ou action).
 */
export function KpiCard({
  label,
  shortLabel,
  value,
  icon: Icon,
  tone = "neutral",
  href,
  onClick,
}: {
  label: string;
  /** Libellé court affiché sur téléphone (sinon le libellé complet). */
  shortLabel?: string;
  value: number;
  icon: LucideIcon;
  tone?: "neutral" | "danger";
  href?: string;
  onClick?: () => void;
}) {
  const alert = tone === "danger" && value > 0;
  const className =
    "group flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3.5 py-2.5 text-start shadow-card transition-colors hover:bg-surface-hover md:block md:p-5";
  const body = (
    <>
      <div className="flex min-w-0 items-center gap-2 md:justify-between">
        <Icon className={cn("size-4 shrink-0 md:order-2", alert ? "text-danger" : "text-faint")} strokeWidth={1.9} />
        <span className="truncate text-caption text-muted md:order-1">
          <span className="md:hidden">{shortLabel ?? label}</span>
          <span className="hidden md:inline">{label}</span>
        </span>
      </div>
      <div className="flex items-center gap-1 md:mt-2 md:justify-between">
        <span className={cn("text-[22px] font-bold leading-7 tabular md:text-display", alert && "text-danger")}>{value}</span>
        <ChevronRight className="hidden size-4 text-faint transition-transform group-hover:translate-x-0.5 md:block rtl:-scale-x-100" aria-hidden />
      </div>
    </>
  );
  if (href)
    return (
      <Link href={href} className={className}>
        {body}
      </Link>
    );
  return (
    <button type="button" onClick={onClick} className={className}>
      {body}
    </button>
  );
}
