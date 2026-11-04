"use client";

import { useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { createCleaningForStay, planLinenDelivery } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Link } from "@/i18n/navigation";
import { fromLocalInput, localInputIn } from "@/lib/connected/format";
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

/**
 * Livraison de linge : fiche courte préremplie, vérifiée par le responsable avant création.
 * Échéance = arrivée du voyageur ; début conseillé (recommandation, pas une contrainte) ; durée estimée ;
 * agent ou « attribuer plus tard » ; ce que HALO ne sait pas. La base ne crée jamais de doublon.
 */
export function PlanLinenForm({
  stayId,
  label,
  checkInAt,
  propertyName,
  guestName,
  members,
  timeZone,
}: {
  stayId: string;
  label: string;
  checkInAt: string;
  propertyName: string;
  guestName: string;
  members: { id: string; name: string }[];
  timeZone?: string;
}) {
  const t = useTranslations("connected.linenPlan");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const arrival = new Date(checkInAt);
  const [start, setStart] = useState(() => localInputIn(new Date(Math.max(Date.now(), arrival.getTime() - 24 * 3_600_000)), timeZone));
  const [end, setEnd] = useState(() => localInputIn(arrival, timeZone));
  const [duration, setDuration] = useState(20);
  const [assignee, setAssignee] = useState("");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<{ id: string; existed: boolean } | null>(null);
  const sending = useRef(false);
  const at = (d: Date) => f.dateTime(d, { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  if (done)
    return (
      <p className="text-[13px]" role="status" data-testid="linen-planned">
        {t(done.existed ? "existed" : "created")}{" "}
        <Link href={`/app/missions/${done.id}`} className="font-medium text-accent-text underline">
          {t("open")}
        </Link>
      </p>
    );
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)} data-testid="plan-linen">
        {label}
      </Button>
    );
  return (
    <div className="w-full basis-full space-y-3 rounded-md border border-line bg-subtle p-3 text-[14px] dark:bg-surface-hover" data-testid="linen-form">
      <p className="font-semibold">{t("title", { property: propertyName, guest: guestName || "—" })}</p>
      <p data-testid="linen-deadline">{t("deadline", { date: at(arrival) })}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label={t("startLabel")} htmlFor={`ls-${stayId}`} hint={t("startHint")}>
          <Input id={`ls-${stayId}`} type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} data-testid="linen-start" />
        </Field>
        <Field label={t("endLabel")} htmlFor={`le-${stayId}`} hint={t("endHint")}>
          <Input id={`le-${stayId}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="linen-end" />
        </Field>
        <Field label={t("durationLabel")} htmlFor={`ld-${stayId}`} hint={t("durationHint")}>
          <Input id={`ld-${stayId}`} type="number" min={5} max={480} value={duration} onChange={(e) => setDuration(Number(e.target.value) || 0)} data-testid="linen-duration" />
        </Field>
      </div>
      <Field label={t("assigneeLabel")} htmlFor={`la-${stayId}`}>
        <Select id={`la-${stayId}`} value={assignee} onChange={(e) => setAssignee(e.target.value)} data-testid="linen-assignee">
          <option value="">{t("later")}</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("noteLabel")} htmlFor={`ln-${stayId}`}>
        <Textarea id={`ln-${stayId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
      </Field>
      <p className="text-[13px] text-muted" data-testid="linen-unknown">{t("unknown")}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={pending}
          onClick={() => {
            if (sending.current) return;
            sending.current = true;
            run(
              () =>
                planLinenDelivery(stayId, { start: fromLocalInput(start, timeZone).toISOString(), end: fromLocalInput(end, timeZone).toISOString(), durationMin: duration, assigneeId: assignee || null, note }).finally(() => {
                  sending.current = false;
                }),
              (d) => setDone(d),
            );
          }}
          data-testid="linen-confirm"
        >
          {t("confirm")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </div>
  );
}
