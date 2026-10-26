import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyState({
  icon: Icon,
  title,
  text,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center px-6 py-14 text-center", className)}>
      <span className="grid size-14 place-items-center rounded-full bg-subtle text-muted dark:bg-surface-hover">
        <Icon className="size-7" strokeWidth={1.6} />
      </span>
      <h3 className="mt-4 text-title-3">{title}</h3>
      {text && <p className="mt-1 max-w-sm text-body text-muted">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
