"use client";

import { useEffect, useRef, useState } from "react";
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
 * et l'effet prévu sur chaque mission liée. Avec un risque connu, la décision exige un accord explicite.
 */
export function TimingDecision({
  serviceId,
  status,
  check,
  names,
  timeZone,
}: {
  serviceId: string;
  status: string;
  check: TimingCheck;
  names: Record<string, string>;
  timeZone: string;
}) {
  const t = useTranslations("connected.timingDecision");
  const tts = useTranslations("taskStatus");
  const tt = useTranslations("taskType");
  const f = useFormatter();
  const { pending, error, run, id: runId } = useRun();
  const [ack, setAck] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState("");
  const [result, setResult] = useState<{ status: string; check?: TimingCheck } | null>(null);
  // Un seul envoi à la fois (double clic) ; la base refuse aussi une seconde confirmation
  const sending = useRef(false);
  // Une autre décision réussie (refus, précision…) rend un ancien message d'échec obsolète
  useEffect(() => {
    const clear = (e: Event) => {
      if ((e as CustomEvent<string>).detail !== runId) setResult((r) => (r && r.status !== "applied" ? null : r));
    };
    window.addEventListener("halo:action-ok", clear);
    return () => window.removeEventListener("halo:action-ok", clear);
  }, [runId]);
  const at = (x: string) => f.dateTime(new Date(x), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone });
  const c = result?.check ?? check;
  const early = c.kind === "early_checkin";
  const open = ["requested", "in_review", "info_requested"].includes(status);
  const state = c.state ?? (status === "confirmed" ? (c.legacy_mismatch ? "contradiction" : "applied") : "pending");
  const legacy = status === "confirmed" && state === "contradiction";
  const superseded = status === "confirmed" && state === "superseded";
  const hasRisks = c.risks.length > 0;
  const blocked = c.blocking.length > 0;
  const k = c.cleaning;
  const go = (act: "confirm" | "cancel" | "apply_legacy", force = false) => {
    if (sending.current) return;
    sending.current = true;
    run(
      () => decideTiming(serviceId, act, { ack: ack || force, expectedAt: act === "cancel" ? null : c.current_at, message, note }).finally(() => (sending.current = false)),
      (d) => setResult(d),
    );
  };

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

      {legacy && (
        <div className="rounded-md border border-danger bg-danger-soft p-3 text-[14px]" role="alert" data-testid="timing-legacy">
          <p className="font-semibold text-danger">{t("legacyTitle")}</p>
          <p className="mt-1">{t("legacyText", { confirmed: at(c.requested_at), stay: at(c.current_at) })}</p>
        </div>
      )}

      {status === "confirmed" && !legacy && (
        <p className="rounded-md border border-line bg-subtle p-3 text-[14px] dark:bg-surface-hover" data-testid="timing-state" data-state={state}>
          {t(`state.${["applied", "superseded", "covered"].includes(state) ? state : "applied"}.${early ? "early" : "late"}`, {
            stay: at(c.current_at),
            confirmed: at(c.requested_at),
            by: c.superseded_by_at ? at(c.superseded_by_at) : "—",
          })}
          {superseded && c.superseded_by && (
            <>
              {" "}
              <Link href={`/app/services/${c.superseded_by}`} className="text-accent-text hover:underline" data-testid="timing-superseded-link">
                {t("state.openLater")}
              </Link>
            </>
          )}
        </p>
      )}
      {open && !c.change && c.no_change && (
        <p className="text-[14px]" data-testid="timing-no-change" data-reason={c.no_change}>
          {t(`noChange.${c.no_change}.${early ? "early" : "late"}`, { stay: at(c.current_at) })}
        </p>
      )}

      {c.change && (
        <div className="text-[14px]" data-testid="timing-facts">
          <p className="font-medium">{t("knownTitle")}</p>
          {!k && <p className="mt-1">{t("noCleaning")}</p>}
          {(c.tasks ?? []).length > 0 && (
            <ul className="mt-1 space-y-1.5">
              {(c.tasks ?? []).map((x) => (
                <li key={x.id} className="rounded-md border border-line p-2" data-testid="timing-task" data-effect={x.effect}>
                  <Link href={`/app/missions/${x.id}`} className="font-medium text-accent-text hover:underline">
                    {x.title ? `${x.title} (${tt(x.type)})` : tt(x.type)}
                  </Link>{" "}
                  · {tts(x.status)} · {x.assignee_id ? t("assignedTo", { name: names[x.assignee_id] ?? "—" }) : t("unassigned")}
                  <span className="block text-[13px] text-muted">
                    {t("from", { date: at(x.window_start) })} · {t("until", { date: at(x.window_end) })} · {t("duration", { duration: durationText(x.duration_min) })} ·{" "}
                    {x.scheduled_start ? t("slot", { date: at(x.scheduled_start) }) : t("noSlot")}
                  </span>
                  <span className="block text-[13px]" data-testid="timing-task-effect">
                    {t(`effect.${x.effect}`, { time: at(c.requested_at) })}
                    {["in_progress", "to_redo"].includes(x.status) ? ` ${t("inProgress")}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(c.actions ?? []).length > 0 && <p className="mt-2 font-medium">{t("actionsTitle")}</p>}
          {(c.actions ?? []).map((a) => (
            <p key={a.id} className="mt-1" data-testid="timing-action" data-effect={a.effect ?? ""}>
              {a.effect
                ? t(`actionEffect.${a.effect}`, { title: a.title, due: a.due_at ? at(a.due_at) : "", time: at(c.requested_at) })
                : t("action", { title: a.title, due: a.due_at ? at(a.due_at) : t("noDue") })}
              {a.task_status ? ` · ${t("linkedMission", { status: tts(a.task_status) })}` : ""}
            </p>
          ))}
          {(c.done_actions ?? 0) > 0 && (
            <p className="mt-1 text-muted" data-testid="timing-actions-done">
              {t("actionsDone", { n: c.done_actions ?? 0 })}
            </p>
          )}
          {c.incidents && (c.incidents.open > 0 || c.incidents.linen > 0) && (
            <p className="mt-1" data-testid="timing-incidents">
              {t("incidents", { open: c.incidents.open, linen: c.incidents.linen })}
            </p>
          )}
          <p className="mt-2 text-[13px] text-muted" data-testid="timing-not-ready">
            {t("notReady")}
          </p>
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
      {!blocked && hasRisks && (open || legacy) && (
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
      {c.change && (open || legacy) && (
        <p className="text-[13px] text-muted" data-testid="timing-unverified">
          {t("unverified")}
        </p>
      )}

      {(open || legacy) && !blocked && (
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
          <div className="flex flex-wrap gap-2">
            <Button disabled={pending || (hasRisks && !ack)} onClick={() => go(legacy ? "apply_legacy" : "confirm")} data-testid={legacy ? "timing-apply-legacy" : "timing-confirm"}>
              {legacy ? t("applyLegacy") : t("confirm")}
            </Button>
            {legacy && (
              <Button variant="outline" disabled={pending} onClick={() => go("cancel")} data-testid="timing-withdraw-legacy">
                {t("withdrawLegacy")}
              </Button>
            )}
          </div>
          {hasRisks && !ack && <p className="text-[12px] text-muted">{t("ackNeeded")}</p>}
          {!legacy && <p className="text-[12px] text-muted">{t("otherDecisions")}</p>}
        </div>
      )}
      {legacy && blocked && (
        <Button variant="outline" disabled={pending} onClick={() => go("cancel")} data-testid="timing-withdraw-legacy">
          {t("withdrawLegacy")}
        </Button>
      )}
      {status === "confirmed" && !legacy && (
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-[14px]">{t(superseded ? "supersededText" : state === "covered" ? "coveredText" : "confirmedText")}</p>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => go("cancel")} data-testid="timing-cancel">
            {t(superseded ? "withdrawSuperseded" : "cancel")}
          </Button>
        </div>
      )}
      {result?.status === "restore_unsafe" && (
        <div role="alert" className="rounded-md border border-warning bg-warning-soft p-3 text-[14px]" data-testid="timing-restore-unsafe">
          <p className="font-semibold">{t("restoreUnsafeTitle")}</p>
          <p className="mt-1">{t("restoreUnsafeText")}</p>
          <Button size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => go("cancel", true)} data-testid="timing-withdraw-only">
            {t("withdrawOnly")}
          </Button>
        </div>
      )}
      {result && result.status !== "applied" && result.status !== "restore_unsafe" && (
        <p role="alert" className="text-[14px] text-danger" data-testid="timing-result" data-status={result.status}>
          {t(`result.${["risks", "not_feasible", "stay_changed", "already", "conflict", "no_stay", "superseded"].includes(result.status) ? result.status : "conflict"}`)}
        </p>
      )}
      {result?.status === "applied" && (
        <p role="status" className="text-[14px] text-success" data-testid="timing-result" data-status="applied">
          {t("result.applied")}
        </p>
      )}
      {error && <p role="alert" className="text-[14px] text-danger" data-testid="timing-error">{error}</p>}
    </Card>
  );
}
