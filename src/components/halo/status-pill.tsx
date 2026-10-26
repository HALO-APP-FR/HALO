import { useTranslations } from "next-intl";
import type { TaskStatus } from "@/lib/demo/data";
import { cn } from "@/lib/utils";

const TONE: Record<TaskStatus, { dot: string; text: string }> = {
  unassigned: { dot: "bg-danger", text: "text-danger" },
  assigned: { dot: "bg-faint", text: "text-muted" },
  in_progress: { dot: "bg-accent animate-pulse", text: "text-accent-text" },
  done: { dot: "bg-warning", text: "text-warning" },
  to_redo: { dot: "bg-danger", text: "text-danger" },
  validated: { dot: "bg-success", text: "text-success" },
  cancelled: { dot: "bg-faint", text: "text-faint line-through" },
};

export function StatusPill({ status, className }: { status: TaskStatus; className?: string }) {
  const t = useTranslations("taskStatus");
  const tone = TONE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-micro", tone.text, className)}>
      <span className={cn("size-1.5 rounded-full", tone.dot)} aria-hidden />
      {t(status)}
    </span>
  );
}
