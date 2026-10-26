import { cn } from "@/lib/utils";

export function Avatar({
  initials,
  color,
  size = "md",
  className,
  label,
}: {
  initials: string;
  color?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}) {
  const dims = { sm: "size-6 text-[10px]", md: "size-8 text-[12px]", lg: "size-11 text-[15px]" }[size];
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      title={label}
      className={cn("grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-surface", dims, className)}
      style={{ backgroundColor: color ?? "var(--text-muted)" }}
    >
      {initials}
    </span>
  );
}
