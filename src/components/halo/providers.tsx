"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DataBoot } from "./data-boot";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        <DataBoot />
        {children}
        <Toaster
          position="bottom-center"
          toastOptions={{
            className: "!rounded-lg !border-line !bg-fg !text-canvas !shadow-overlay !font-sans",
            duration: 4000,
          }}
        />
      </TooltipProvider>
    </ThemeProvider>
  );
}
