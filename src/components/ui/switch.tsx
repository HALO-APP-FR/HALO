"use client";

import * as React from "react";
import { Switch as S } from "radix-ui";
import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: React.ComponentProps<typeof S.Root>) {
  return (
    <S.Root
      className={cn(
        "relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full bg-line-strong transition-colors duration-150 data-[state=checked]:bg-accent disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <S.Thumb className="block size-6 translate-x-0.5 rounded-full bg-white shadow-float transition-transform duration-150 data-[state=checked]:translate-x-[22px] rtl:data-[state=checked]:-translate-x-[22px]" />
    </S.Root>
  );
}

/** Ligne de réglage : libellé + description + interrupteur. */
export function SwitchRow({
  id,
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  id: string;
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <label htmlFor={id} className="min-w-0 cursor-pointer">
        <span className="block text-[15px] font-medium">{label}</span>
        {description && <span className="mt-0.5 block text-caption text-muted">{description}</span>}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </div>
  );
}
