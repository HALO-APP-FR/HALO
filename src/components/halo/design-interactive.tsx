"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Bell, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

export function DesignInteractive() {
  const t = useTranslations("design");
  return (
    <div className="flex flex-wrap gap-3">
      <Button
        variant="secondary"
        onClick={() => toast(t("toastText"), { action: { label: t("undo"), onClick: () => undefined } })}
      >
        <Bell />
        {t("showToast")}
      </Button>
      <Sheet>
        <SheetTrigger asChild>
          <Button variant="secondary">
            <PanelRight />
            {t("openSheet")}
          </Button>
        </SheetTrigger>
        <SheetContent title={t("sheet")} description={t("sheetText")}>
          <div className="space-y-3 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 rounded-md bg-subtle dark:bg-surface-hover" />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
