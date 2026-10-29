"use client";

import { useTranslations } from "next-intl";
import { createCleaningForStay, planLinenDelivery } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { useRun } from "./use-run";

export function CreateCleaningButton({ stayId, label, kind = "cleaning" }: { stayId: string; label: string; kind?: "cleaning" | "linen" }) {
  const te = useTranslations("connected.errors");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" onClick={() => run(() => (kind === "linen" ? planLinenDelivery(stayId) : createCleaningForStay(stayId)))} disabled={pending} data-testid={kind === "linen" ? "plan-linen" : "create-cleaning"}>
        {label}
      </Button>
      {error && <span role="alert" className="text-[12px] text-danger">{error || te("server")}</span>}
    </span>
  );
}
