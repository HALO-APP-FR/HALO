"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { createIntervention, resolveIncident, takeIncident } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";
import { fromLocalInput, localInputIn } from "@/lib/connected/format";

export function IncidentActions({
  id,
  status,
  fromGuest,
  guestHasEmail,
  hasIntervention,
  members,
  timeZone,
}: {
  id: string;
  status: string;
  fromGuest: boolean;
  guestHasEmail: boolean;
  hasIntervention: boolean;
  members: { id: string; name: string }[];
  /** Fuseau du logement : la plage saisie est une heure locale du logement */
  timeZone?: string;
}) {
  const t = useTranslations("connected.incidents");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [resolution, setResolution] = useState("");
  const [message, setMessage] = useState("");
  const [plan, setPlan] = useState(false);
  const [iv, setIv] = useState(() => {
    const start = new Date(Math.ceil(Date.now() / 900_000) * 900_000);
    return { assignee: "", start: localInputIn(start, timeZone), end: localInputIn(new Date(start.getTime() + 4 * 3_600_000), timeZone), duration: 60 };
  });
  if (status === "resolved") return null;
  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap gap-2">
        {status === "open" && (
          <Button size="sm" variant="outline" onClick={() => run(() => takeIncident(id))} disabled={pending} data-testid="incident-take">
            {t("take")}
          </Button>
        )}
        {!hasIntervention && (
          <Button size="sm" variant="outline" onClick={() => setPlan((o) => !o)} disabled={pending} data-testid="incident-plan-open">
            {t("plan")}
          </Button>
        )}
        <Button size="sm" onClick={() => setOpen((o) => !o)} disabled={pending} data-testid="incident-resolve-open">
          {t("resolve")}
        </Button>
      </div>
      {plan && (
        <form
          className="grid gap-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => createIntervention(id, iv.assignee || null, fromLocalInput(iv.start, timeZone).toISOString(), fromLocalInput(iv.end, timeZone).toISOString(), iv.duration), () => setPlan(false));
          }}
        >
          <Field label={t("planAssignee")} htmlFor={`iva-${id}`} className="sm:col-span-2">
            <Select id={`iva-${id}`} value={iv.assignee} onChange={(e) => { const val = e.target.value; setIv((prev) => ({ ...prev, assignee: val })); }} data-testid="incident-plan-assignee">
              <option value="">{t("planNobody")}</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("planFrom")} htmlFor={`ivs-${id}`}>
            <Input id={`ivs-${id}`} type="datetime-local" value={iv.start} onChange={(e) => { const val = e.target.value; setIv((prev) => ({ ...prev, start: val })); }} />
          </Field>
          <Field label={t("planTo")} htmlFor={`ive-${id}`}>
            <Input id={`ive-${id}`} type="datetime-local" value={iv.end} onChange={(e) => { const val = e.target.value; setIv((prev) => ({ ...prev, end: val })); }} />
          </Field>
          <Field label={t("planDuration")} htmlFor={`ivd-${id}`}>
            <Input id={`ivd-${id}`} type="number" min={5} max={1440} value={iv.duration} onChange={(e) => setIv({ ...iv, duration: Number(e.target.value) })} />
          </Field>
          <p className="text-[13px] text-muted sm:col-span-2">{t("planHint")}</p>
          <div className="sm:col-span-2">
            <Button type="submit" disabled={pending} data-testid="incident-plan">
              {t("planConfirm")}
            </Button>
          </div>
        </form>
      )}
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
