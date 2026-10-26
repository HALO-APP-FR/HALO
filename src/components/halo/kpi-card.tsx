import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Indicateur. Sur téléphone : une ligne compacte (libellé + chiffre), moitié moins haute,
 * pour laisser la place à « À traiter ». Sur ordinateur : carte avec grand chiffre.
 */
export function KpiCard({
  label,
  shortLabel,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  /** Libellé court affiché sur téléphone (sinon le libellé complet). */
  shortLabel?: string;
  value: number;
  icon: LucideIcon;
  tone?: "neutral" | "danger";
}) {
  const alert = tone === "danger" && value > 0;
  return (
    <Card className="flex items-center justify-between gap-2 px-3.5 py-2.5 md:block md:p-5">
      <div className="flex min-w-0 items-center gap-2 md:justify-between">
        <Icon className={cn("size-4 shrink-0 md:order-2", alert ? "text-danger" : "text-faint")} strokeWidth={1.9} />
        <span className="truncate text-caption text-muted md:order-1">
          <span className="md:hidden">{shortLabel ?? label}</span>
          <span className="hidden md:inline">{label}</span>
        </span>
      </div>
      <div className={cn("text-[22px] font-bold leading-7 tabular md:mt-2 md:text-display", alert && "text-danger")}>{value}</div>
    </Card>
  );
}
