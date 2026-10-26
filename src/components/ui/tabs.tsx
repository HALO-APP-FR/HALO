"use client";

import * as React from "react";
import { Tabs as T } from "radix-ui";
import { cn } from "@/lib/utils";

export const Tabs = T.Root;
export const TabsContent = T.Content;

/** Onglets soulignés, défilables horizontalement sur téléphone. */
export function TabsList({ className, ...props }: React.ComponentProps<typeof T.List>) {
  return (
    <T.List
      className={cn("-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 [scrollbar-width:none] md:mx-0 md:px-0", className)}
      {...props}
    />
  );
}

export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof T.Trigger>) {
  return (
    <T.Trigger
      className={cn(
        "relative h-11 shrink-0 whitespace-nowrap px-3 text-[14px] font-medium text-muted transition-colors hover:text-fg",
        "after:absolute after:inset-x-3 after:-bottom-px after:h-0.5 after:rounded-full after:bg-transparent",
        "data-[state=active]:text-fg data-[state=active]:after:bg-accent",
        className,
      )}
      {...props}
    />
  );
}
