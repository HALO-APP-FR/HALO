"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { decideTiming, type TimingCheck } from "@/lib/connected/timing-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Link } from "@/i18n/navigation";
import { durationText } from "@/lib/connected/format";
import { useRun } from "./use-run";

/**
 * Arrivée anticipée / départ tardif : tout ce que HALO sait avant de décider, ce qu'il ne sait pas,
 * et ce que la confirmation change. Avec un risque connu, la confirmation exige un accord explicite.
 */
export function TimingDecision({
  serviceId,
  status,
  check,
  assigneeName,
  timeZone,
}: {
  serviceId: string;
  status: string;
  check: TimingCheck;
  assigneeName: string | null;
  timeZone: string;
}) {
  const t = useTranslations("connected.timingDecision");
  const tts = useTranslations("taskStatus");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ status: string; check?: TimingCheck } | null>(null);
  const at = (x: string) => f.dateTime(new Date(x), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone });
  const c = result?.check ?? check;
  const early = c.kind === "early_checkin";
  const open = ["requested", "in_review", "info_requested"].includes(status);
  const hasRisks = c.risks.length > 0;
  const blocked = c.blocking.length > 0;
  const k = c.cleaning;

  return (
    <Card className="space-y-4 p-5" data-testid="timing-decision">
      <div>
        <h2 className="text-[17px] font-semibold">{t(`title.${c.kind}`)}</h2>
        <dl className="mt-2 grid gap-1 text-[14px] sm:grid-cols-2">
          <div>
            <dt className="text-[12px] font-medium text-muted">{t("requested")}</dt>
            <dd data-testid="timing-requested">{at(c.requested_at)}</dd>
          </div>
          <div>
            <dt className="text-[12px] font-medium text-muted">{early ? t("currentArrival") : t("currentDeparture")}</dt>
            <dd data-testid="timing-current">{at(c.current_at)}</dd>
          </div>
        </dl>
      </div>

      {c.change && (
        <div className="text-[14px]" data-testid="timing-facts">
          <p className="font-medium">{t("knownTitle")}</p>
          <ul className="mt-1 list-disc space-y-0.5 ps-5">
            {k ? (
              <li data-testid="timing-cleaning">
                <Link href={`/app/missions/${k.id}`} className="text-accent-text hover:underline">
                  {t("cleaning")}
                </Link>{" "}
                : {tts(k.status)} · {k.assignee_id ? t("assignedTo", { name: assigneeName ?? "—" }) : t("unassigned")} · {t("from", { date: at(k.window_start) })} · {t("duration", { duration: durationText(k.duration_min) })} ·{" "}
                {k.scheduled_start ? t("slot", { date: at(k.scheduled_start) }) : t("noSlot")}
              </li>
            ) : (
              <li>{t("noCleaning")}</li>
            )}
            {(c.actions ?? []).map((a) => (
              <li key={a.id} data-testid="timing-action">
                {t("action", { title: a.title, due: a.due_at ? at(a.due_at) : t("noDue") })}
                {a.task_status ? ` · ${t("linkedMission", { status: tts(a.task_status) })}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {blocked && (
        <div className="rounded-md border border-danger bg-danger-soft p-3 text-[14px]" role="alert" data-testid="timing-blocking">
          <p className="font-semibold text-danger">{t("blockingTitle")}</p>
          <ul className="mt-1 list-disc ps-5">
            {c.blocking.map((b) => (
              <li key={b}>{t(`blocking.${b}`)}</li>
            ))}
          </ul>
        </div>
      )}
      {!blocked && hasRisks && (
        <div className="rounded-md border border-warning bg-warning-soft p-3 text-[14px]" data-testid="timing-risks">
          <p className="font-semibold">{t("risksTitle")}</p>
          <ul className="mt-1 list-disc ps-5">
            {c.risks.map((r) => (
              <li key={r} data-risk={r}>
                {t(`risk.${r}`)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {c.change && (
        <p className="text-[13px] text-muted" data-testid="timing-unverified">
          {t("unverified")}
        </p>
      )}

      {open && !blocked && (
        <div className="space-y-3 border-t border-line pt-4">
          {c.change && <p className="text-[13px]" data-testid="timing-effects">{t(early ? "effectsEarly" : "effectsLate")}</p>}
          {hasRisks && (
            <label className="flex items-start gap-2 text-[14px]">
              <input type="checkbox" className="mt-1" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="timing-ack" />
              <span>{t("ack")}</span>
            </label>
          )}
          <Field label={t("message")} htmlFor="tm-msg">
            <Textarea id="tm-msg" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000} data-testid="timing-message" />
          </Field>
          <Field label={t("note")} htmlFor="tm-note" hint={t("noteHint")}>
            <Textarea id="tm-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={2000} />
          </Field>
          <Button
            disabled={pending || (hasRisks && !ack)}
            onClick={() => run(() => decideTiming(serviceId, "confirm", { ack, expectedAt: c.current_at, message, note }), (d) => setResult(d))}
            data-testid="timing-confirm"
          >
            {t("confirm")}
          </Button>
          {hasRisks && !ack && <p className="text-[12px] text-muted">{t("ackNeeded")}</p>}
          <p className="text-[12px] text-muted">{t("otherDecisions")}</p>
        </div>
      )}
      {status === "confirmed" && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-[14px]">{t("confirmedText")}</p>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => run(() => decideTiming(serviceId, "cancel", { ack: false, expectedAt: null, message, note }), (d) => setResult(d))} data-testid="timing-cancel">
            {t("cancel")}
          </Button>
        </div>
      )}
      {result && result.status !== "applied" && (
        <p role="alert" className="text-[14px] text-danger" data-testid="timing-result" data-status={result.status}>
          {t(`result.${["risks", "not_feasible", "stay_changed", "already", "conflict", "no_stay"].includes(result.status) ? result.status : "conflict"}`)}
        </p>
      )}
      {result?.status === "applied" && (
        <p role="status" className="text-[14px] text-success" data-testid="timing-result" data-status="applied">
          {t("result.applied")}
        </p>
      )}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </Card>
  );
}
