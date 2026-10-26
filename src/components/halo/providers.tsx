"use client";

import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="data-theme" defaultTheme="system" enableSystem disableTransitionOnChange>
      <TooltipProvider>
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
