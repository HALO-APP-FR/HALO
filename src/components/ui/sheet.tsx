"use client";

import * as React from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

export function SheetContent({
  className,
  children,
  title,
  description,
  closeLabel = "Close",
  ...props
}: React.ComponentProps<typeof Dialog.Content> & {
  title: string;
  description?: string;
  closeLabel?: string;
}) {
  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]" />
      <Dialog.Content
        className={cn(
          // Mobile : feuille du bas. Ordinateur : panneau à droite.
          "fixed z-50 flex flex-col bg-surface shadow-overlay outline-none",
          "inset-x-0 bottom-0 max-h-[92dvh] rounded-t-xl border-t border-line",
          "md:inset-y-0 md:end-0 md:start-auto md:h-dvh md:max-h-none md:w-[480px] md:rounded-none md:border-t-0 md:border-s",
          className,
        )}
        {...props}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong md:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-4 px-5 pb-2 pt-4 md:pt-6">
          <div>
            <Dialog.Title className="text-title-2">{title}</Dialog.Title>
            {description ? (
              <Dialog.Description className="mt-1 text-body text-muted">{description}</Dialog.Description>
            ) : (
              <Dialog.Description className="sr-only">{title}</Dialog.Description>
            )}
          </div>
          <Dialog.Close
            className="grid size-9 place-items-center rounded-md text-muted transition-colors hover:bg-subtle hover:text-fg dark:hover:bg-surface-hover"
            aria-label={closeLabel}
          >
            <X className="size-5" />
          </Dialog.Close>
        </div>
        <div className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden px-5 pb-[max(env(safe-area-inset-bottom),24px)]">{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
