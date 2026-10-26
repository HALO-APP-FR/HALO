"use client";

import { cn } from "@/lib/utils";

/** Sélecteur segmenté (type iOS). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-md bg-subtle p-0.5 dark:bg-surface-hover", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "h-8 flex-1 whitespace-nowrap rounded-[7px] px-3 text-[13px] font-medium text-muted transition-all duration-150",
            value === o.value && "bg-surface text-fg shadow-card dark:bg-line",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
