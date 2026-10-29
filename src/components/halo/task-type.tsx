import {
  BedDouble,
  CircleDot,
  ClipboardCheck,
  DoorClosed,
  KeyRound,
  Package,
  Sparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { TaskType } from "@/lib/domain/types";
import { cn } from "@/lib/utils";

export const TASK_TYPE_META: Record<TaskType, { icon: LucideIcon; text: string; bg: string; bar: string }> = {
  turnover: { icon: Sparkles, text: "text-type-turnover", bg: "bg-type-turnover/10", bar: "bg-type-turnover" },
  check_in: { icon: KeyRound, text: "text-type-checkin", bg: "bg-type-checkin/10", bar: "bg-type-checkin" },
  check_out: { icon: DoorClosed, text: "text-type-checkout", bg: "bg-type-checkout/10", bar: "bg-type-checkout" },
  linen_delivery: { icon: BedDouble, text: "text-type-linen", bg: "bg-type-linen/10", bar: "bg-type-linen" },
  linen_pickup: { icon: Package, text: "text-type-linen", bg: "bg-type-linen/10", bar: "bg-type-linen" },
  inspection: { icon: ClipboardCheck, text: "text-type-other", bg: "bg-type-other/10", bar: "bg-type-other" },
  maintenance: { icon: Wrench, text: "text-type-other", bg: "bg-type-other/10", bar: "bg-type-other" },
  other: { icon: CircleDot, text: "text-type-other", bg: "bg-type-other/10", bar: "bg-type-other" },
};

export function TaskTypeIcon({ type, size = "md", className }: { type: TaskType; size?: "sm" | "md" | "lg"; className?: string }) {
  const meta = TASK_TYPE_META[type];
  const Icon = meta.icon;
  const box = { sm: "size-7 rounded-sm [&_svg]:size-4", md: "size-9 rounded-md [&_svg]:size-[18px]", lg: "size-12 rounded-lg [&_svg]:size-6" }[size];
  return (
    <span className={cn("grid shrink-0 place-items-center", box, meta.bg, meta.text, className)} aria-hidden>
      <Icon strokeWidth={1.9} />
    </span>
  );
}
