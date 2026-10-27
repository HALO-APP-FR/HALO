import { Crown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Repère VIP : préparation et services haut de gamme. */
export function VipBadge({ className }: { className?: string }) {
  return (
    <Badge tone="vip" className={cn("tracking-[0.08em]", className)}>
      <Crown className="size-3" strokeWidth={2.4} aria-hidden />
      VIP
    </Badge>
  );
}
