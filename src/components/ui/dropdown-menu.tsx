"use client";

import * as React from "react";
import { DropdownMenu as DM } from "radix-ui";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const DropdownMenu = DM.Root;
export const DropdownMenuTrigger = DM.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DM.Content>) {
  return (
    <DM.Portal>
      <DM.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-48 rounded-md border border-line bg-surface p-1 shadow-float",
          className,
        )}
        {...props}
      />
    </DM.Portal>
  );
}

export function DropdownMenuLabel({ className, ...props }: React.ComponentProps<typeof DM.Label>) {
  return <DM.Label className={cn("px-2.5 pb-1 pt-2 text-micro text-muted", className)} {...props} />;
}

export function DropdownMenuSeparator({ className, ...props }: React.ComponentProps<typeof DM.Separator>) {
  return <DM.Separator className={cn("my-1 h-px bg-line", className)} {...props} />;
}

export function DropdownMenuItem({ className, ...props }: React.ComponentProps<typeof DM.Item>) {
  return (
    <DM.Item
      className={cn(
        "flex h-9 cursor-default select-none items-center gap-2.5 rounded-sm px-2.5 text-[14px] outline-none data-[highlighted]:bg-subtle dark:data-[highlighted]:bg-surface-hover [&_svg]:size-4 [&_svg]:text-muted",
        className,
      )}
      {...props}
    />
  );
}

export const DropdownMenuRadioGroup = DM.RadioGroup;

export function DropdownMenuRadioItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DM.RadioItem>) {
  return (
    <DM.RadioItem
      className={cn(
        "flex h-9 cursor-default select-none items-center justify-between gap-2.5 rounded-sm px-2.5 text-[14px] outline-none data-[highlighted]:bg-subtle dark:data-[highlighted]:bg-surface-hover",
        className,
      )}
      {...props}
    >
      <span className="flex items-center gap-2.5 [&_svg]:size-4 [&_svg]:text-muted">{children}</span>
      <DM.ItemIndicator>
        <Check className="size-4 text-accent-text" />
      </DM.ItemIndicator>
    </DM.RadioItem>
  );
}
