"use client";

import { useTranslations } from "next-intl";
import { createCleaningForStay } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { useRun } from "./use-run";

export function CreateCleaningButton({ stayId, label }: { stayId: string; label: string }) {
  const te = useTranslations("connected.errors");
  const { pending, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button size="sm" onClick={() => run(() => createCleaningForStay(stayId))} disabled={pending} data-testid="create-cleaning">
        {label}
      </Button>
      {error && <span role="alert" className="text-[12px] text-danger">{error || te("server")}</span>}
    </span>
  );
}
