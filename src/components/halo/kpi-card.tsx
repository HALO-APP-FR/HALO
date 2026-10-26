import type { LucideIcon } from "lucide-react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  tone?: "neutral" | "danger";
}) {
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between">
        <span className="text-caption text-muted">{label}</span>
        <Icon className={cn("size-4", tone === "danger" && value > 0 ? "text-danger" : "text-faint")} strokeWidth={1.9} />
      </div>
      <div className={cn("mt-2 text-display tabular", tone === "danger" && value > 0 && "text-danger")}>{value}</div>
    </Card>
  );
}
