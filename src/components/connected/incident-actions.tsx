"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { resolveIncident, takeIncident } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/field";
import { useRun } from "./use-run";

export function IncidentActions({ id, status, fromGuest, guestHasEmail }: { id: string; status: string; fromGuest: boolean; guestHasEmail: boolean }) {
  const t = useTranslations("connected.incidents");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [message, setMessage] = useState("");
  if (status === "resolved") return null;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <Button size="sm" variant="outline" onClick={() => run(() => takeIncident(id))} disabled={pending} data-testid="incident-take">
            {t("take")}
          </Button>
        )}
        <Button size="sm" onClick={() => setOpen((o) => !o)} disabled={pending} data-testid="incident-resolve-open">
          {t("resolve")}
        </Button>
      </div>
      {open && (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => resolveIncident(id, resolution.trim(), message.trim()), () => setOpen(false));
          }}
        >
          <Field label={t("resolution")} htmlFor={`res-${id}`} hint={t("resolutionHint")}>
            <Textarea id={`res-${id}`} value={resolution} onChange={(e) => setResolution(e.target.value)} maxLength={2000} className="border-dashed bg-subtle dark:bg-surface-hover" data-testid="incident-resolution" />
          </Field>
          {fromGuest && (
            <Field label={t("guestMessage")} htmlFor={`msg-${id}`} hint={guestHasEmail ? t("guestMessageHintEmail") : t("guestMessageHint")}>
              <Textarea id={`msg-${id}`} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} data-testid="incident-guest-message" />
            </Field>
          )}
          <Button type="submit" disabled={pending || !resolution.trim()} data-testid="incident-resolve">
            {t("confirmResolve")}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}
