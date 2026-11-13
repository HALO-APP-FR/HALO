"use client";

import { useEffect, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Timer } from "lucide-react";
import { cancelStartedTask, reassignStartedTask, decideTaskEnd, keepIncidentOpen, overrunContinue, proposeTaskEnd, regularizeTaskEnd, resolveIncident, setOverrunAlert } from "@/lib/connected/actions";
import { durationText, fromLocalInput, localInputIn } from "@/lib/connected/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Link, useRouter } from "@/i18n/navigation";
import { useRun } from "./use-run";
import { overrunDueAt } from "@/lib/engine/overrun";

/**
 * Rappel à l'agent quand la durée estimée est atteinte depuis le démarrage réel.
 * Calculé sur l'appareil (fonctionne hors ligne, sans recharger) ; affiché dans l'application uniquement :
 * HALO n'envoie pas encore de notification push, l'agent ne le voit donc que s'il ouvre l'application.
 * Le temps n'est jamais arrêté automatiquement et le dépassement n'est jamais qualifié.
 */
export function OverrunPrompt({ taskId, startedAt, durationMin, ackAt, timeZone }: { taskId: string; startedAt: string; durationMin: number; ackAt: string | null; timeZone?: string }) {
  const t = useTranslations("connected.overrun");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const router = useRouter();
  const dueAt = overrunDueAt(startedAt, durationMin, ackAt);
  const [now, setNow] = useState<number | null>(null);
  const [forgot, setForgot] = useState(false);
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const [sent, setSent] = useState(false);
  // Rappel devenu périmé (mission terminée, annulée ou réattribuée ailleurs) : rien n'est enregistré
  const [stale, setStale] = useState(false);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 30_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);
  if (stale)
    return (
      <p className="mb-4 rounded-xl border border-line bg-surface p-4 text-[14px] text-muted" role="status" data-testid="overrun-stale">
        {t("stale")}{" "}
        <button type="button" className="font-medium text-accent-text underline" onClick={() => router.refresh()}>
          {t("refresh")}
        </button>
      </p>
    );
  if (dueAt === null || now === null || now < dueAt) return null;
  const elapsed = Math.round((now - Date.parse(startedAt)) / 60_000);
  const at = (ms: number) => f.dateTime(new Date(ms), { hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  return (
    <div className="mb-4 rounded-xl border border-warning bg-warning-soft p-4 text-[15px]" role="alert" data-testid="overrun-prompt">
      <p className="flex items-center gap-2 font-semibold">
        <Timer className="size-5 shrink-0" />
        {t("question")}
      </p>
      <p className="mt-1 text-[14px]" data-testid="overrun-detail">
        {t("title", { duration: durationText(durationMin) })} · {t("text", { since: at(Date.parse(startedAt)), elapsed: durationText(elapsed) })}
      </p>
      <p className="mt-1 text-[12px] text-muted" data-testid="overrun-channel">{t("channel")}</p>
      {!sent && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="lg"
            variant="outline"
            onClick={() =>
              // Réponse « périmée » : affichée telle quelle, sans recharger (sinon le message disparaîtrait avec le rappel)
              run(async () => {
                const r = await overrunContinue(taskId);
                if (r.ok && r.data.result === "stale") {
                  setStale(true);
                  return { ok: false as const, error: "__stale" };
                }
                return r;
              })
            }
            disabled={pending}
            data-testid="overrun-continue"
          >
            {t("continue")}
          </Button>
          <Button size="lg" onClick={() => document.querySelector<HTMLElement>("[data-testid=mission-finish]")?.scrollIntoView({ behavior: "smooth", block: "center" })} data-testid="overrun-finished">
            {t("finished")}
          </Button>
        </div>
      )}
      <p className="mt-2 text-[13px] text-muted">{t("finishedHint")}</p>
      {!sent && (
        <button type="button" className="mt-2 text-[14px] font-medium underline" onClick={() => { setForgot((o) => !o); if (!end) setEnd(localInputIn(new Date(Date.parse(startedAt) + durationMin * 60_000), timeZone)); }} data-testid="overrun-forgot">
          {t("forgot")}
        </button>
      )}
      {forgot && !sent && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const iso = fromLocalInput(end, timeZone).toISOString();
            run(async () => {
              const r = await proposeTaskEnd(taskId, iso, note);
              if (r.ok && r.data.result === "stale") {
                setStale(true);
                return { ok: false as const, error: "__stale" };
              }
              return r;
            }, () => setSent(true));
          }}
        >
          <Field label={t("endLabel")} htmlFor={`end-${taskId}`} hint={t("endHint")}>
            <Input id={`end-${taskId}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required data-testid="overrun-end" />
          </Field>
          <Field label={t("noteLabel")} htmlFor={`endnote-${taskId}`}>
            <Textarea id={`endnote-${taskId}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} data-testid="overrun-note" />
          </Field>
          <Button type="submit" disabled={pending || !end} data-testid="overrun-propose">
            {t("propose")}
          </Button>
        </form>
      )}
      {sent && <p className="mt-2 text-[14px] font-medium" role="status" data-testid="overrun-proposed">{t("proposed")}</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}

/** Heure de fin proposée par l'agent après coup : le responsable l'accepte ou la refuse (historique conservé). */
export function EndProposal({ taskId, declaredAt, proposedAt, note, status, canDecide, timeZone }: { taskId: string; declaredAt: string | null; proposedAt: string; note: string | null; status: string; canDecide: boolean; timeZone?: string }) {
  const t = useTranslations("connected.overrun");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const when = f.dateTime(new Date(proposedAt), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  return (
    <div className={`mb-4 rounded-xl border p-4 text-[15px] ${status === "pending" ? "border-accent bg-accent-soft" : "border-line bg-surface"}`} data-testid="end-proposal" data-status={status}>
      <p className="font-semibold">{t(`proposal.${status}`, { when })}</p>
      {declaredAt && (
        <p className="mt-0.5 text-[13px] text-muted" data-testid="end-declared">
          {t("declaredAt", { at: f.dateTime(new Date(declaredAt), { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) }) })}
        </p>
      )}
      {note && <p className="mt-1 whitespace-pre-wrap text-[14px]">« {note} »</p>}
      {status === "pending" && canDecide && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => run(() => decideTaskEnd(taskId, true))} disabled={pending} data-testid="end-accept">
            {t("accept")}
          </Button>
          <Button variant="outline" onClick={() => run(() => decideTaskEnd(taskId, false))} disabled={pending} data-testid="end-reject">
            {t("reject")}
          </Button>
        </div>
      )}
      {status === "pending" && !canDecide && <p className="mt-1 text-[14px] text-muted">{t("waiting")}</p>}
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}

/**
 * Après validation de l'intervention : « L'incident est-il résolu ? ».
 * Résoudre (avec un compte rendu) ou le laisser ouvert ; la validation de l'intervention ne résout jamais l'incident.
 * Incident signalé par un voyageur : la résolution se fait depuis la liste des incidents (message au voyageur possible).
 */
export function IncidentResolvePrompt({ incidentId, description, fromGuest, inList = false }: { incidentId: string; description: string; fromGuest: boolean; inList?: boolean }) {
  const t = useTranslations("connected.incidentResolve");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  return (
    <div className="mb-4 rounded-xl border border-accent bg-accent-soft p-4 text-[15px]" data-testid="incident-resolve-prompt">
      <p className="font-semibold">{t("title")}</p>
      <p className="mt-1 text-[14px]">{description}</p>
      <p className="mt-1 text-[13px] text-muted">{t("hint")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {fromGuest && inList ? (
          <p className="w-full text-[14px]" data-testid="incident-resolve-below">{t("useBelow")}</p>
        ) : fromGuest ? (
          <Link href={`/app/incidents#incident-${incidentId}`} className="inline-flex h-9 items-center rounded-md bg-accent px-4 text-[14px] font-medium text-on-accent hover:bg-accent-hover" data-testid="incident-resolve-yes">
            {t("yesGuest")}
          </Link>
        ) : (
          <Button onClick={() => setOpen((o) => !o)} disabled={pending} data-testid="incident-resolve-yes">
            {t("yes")}
          </Button>
        )}
        <Button variant="outline" onClick={() => run(() => keepIncidentOpen(incidentId))} disabled={pending} data-testid="incident-keep-open">
          {t("no")}
        </Button>
      </div>
      {open && (
        <form
          className="mt-3 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(() => resolveIncident(incidentId, text, ""));
          }}
        >
          <Field label={t("resolution")} htmlFor={`res-${incidentId}`}>
            <Textarea id={`res-${incidentId}`} value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} required data-testid="incident-resolve-text" />
          </Field>
          <Button type="submit" disabled={pending || !text.trim()} data-testid="incident-resolve-confirm">
            {t("confirm")}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}

/** Réglage : délai après la durée estimée avant d'alerter le responsable (affichage au tableau de bord). */
export function OverrunAlertSetting({ initial, available }: { initial: number; available: boolean }) {
  const t = useTranslations("connected.overrun.setting");
  const { pending, error, run } = useRun();
  const [v, setV] = useState(String(initial));
  const [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        setSaved(false);
        run(() => setOverrunAlert(Number(v)), () => setSaved(true));
      }}
      data-testid="overrun-setting"
    >
      <Field label={t("label")} htmlFor="overrun-min" hint={t("hint")}>
        <Input id="overrun-min" type="number" min={0} max={720} step={5} value={v} onChange={(e) => { setV(e.target.value); setSaved(false); }} className="max-w-32" disabled={!available} data-testid="overrun-min" />
      </Field>
      <Button type="submit" size="sm" disabled={pending || !available || v === ""} data-testid="overrun-save">
        {t("save")}
      </Button>
      {!available && <p className="text-[13px] text-muted">{t("unavailable")}</p>}
      {saved && <p role="status" className="text-[14px] text-success" data-testid="overrun-saved">{t("saved")}</p>}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </form>
  );
}

/**
 * Mission oubliée (responsable) : régulariser la fin quand l'agent n'est pas disponible, ou annuler la mission commencée.
 * Motif obligatoire ; ni l'une ni l'autre ne valide le travail. Les preuves manquantes sont annoncées avant de confirmer.
 */
export function ForgottenMissionPanel({ taskId, startedAt, durationMin, proposedAt, missing, timeZone, members = [] }: { taskId: string; startedAt: string; durationMin: number; proposedAt: string | null; missing: string[]; timeZone?: string; /** Autres membres actifs (réattribution) */ members?: { id: string; name: string }[] }) {
  const t = useTranslations("connected.forgotten");
  const { pending, error, run } = useRun();
  const [mode, setMode] = useState<"" | "end" | "cancel" | "reassign">("");
  const [to, setTo] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const open = (m: "end" | "cancel" | "reassign") => {
    setMode((x) => (x === m ? "" : m));
    setReason("");
    if (m === "end" && !end) {
      const guess = proposedAt ? Date.parse(proposedAt) : Math.min(Date.parse(startedAt) + durationMin * 60_000, Date.now());
      setEnd(localInputIn(new Date(guess), timeZone));
    }
  };
  return (
    <div className="mb-4 rounded-xl border border-line bg-surface p-4 text-[15px] shadow-card" data-testid="forgotten-panel">
      <p className="font-semibold">{t("title")}</p>
      <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant={mode === "end" ? "primary" : "outline"} onClick={() => open("end")} data-testid="regularize-open">
          {t("regularize")}
        </Button>
        {members.length > 0 && (
          <Button variant={mode === "reassign" ? "primary" : "outline"} onClick={() => open("reassign")} data-testid="reassign-started-open">
            {t("reassign")}
          </Button>
        )}
        <Button variant={mode === "cancel" ? "danger" : "outline"} onClick={() => open("cancel")} data-testid="cancel-started-open">
          {t("cancel")}
        </Button>
      </div>
      {mode !== "" && (
        <form
          className="mt-4 space-y-3 border-t border-line pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (mode === "end") run(() => regularizeTaskEnd(taskId, fromLocalInput(end, timeZone).toISOString(), reason));
            else if (mode === "reassign") run(() => reassignStartedTask(taskId, to, reason));
            else run(() => cancelStartedTask(taskId, reason));
          }}
        >
          {mode === "end" && (
            <Field label={t("endLabel")} htmlFor={`reg-end-${taskId}`} hint={t("endHint")}>
              <Input id={`reg-end-${taskId}`} type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} required data-testid="regularize-end" />
            </Field>
          )}
          {mode === "reassign" && (
            <Field label={t("reassignTo")} htmlFor={`reassign-${taskId}`}>
              <Select id={`reassign-${taskId}`} value={to} onChange={(e) => setTo(e.target.value)} required data-testid="reassign-member">
                <option value="">—</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={t("reasonLabel")} htmlFor={`reg-why-${taskId}`} hint={mode === "end" ? t("reasonHintEnd") : mode === "reassign" ? t("reasonHintReassign") : t("reasonHintCancel")}>
            <Textarea id={`reg-why-${taskId}`} value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={1000} rows={2} required data-testid="regularize-reason" />
          </Field>
          {mode === "end" && missing.length > 0 && (
            <p className="rounded-md border border-warning bg-warning-soft p-3 text-[14px]" role="alert" data-testid="regularize-missing">
              {t("missingWarning", { items: missing.join(", ") })}
            </p>
          )}
          <p className="text-[13px] text-muted">{mode === "end" ? t("effectsEnd") : mode === "reassign" ? t("effectsReassign") : t("effectsCancel")}</p>
          <Button type="submit" variant={mode === "cancel" ? "danger" : "primary"} disabled={pending || reason.trim().length < 3 || (mode === "end" && !end) || (mode === "reassign" && !to)} data-testid={mode === "end" ? "regularize-confirm" : mode === "reassign" ? "reassign-started-confirm" : "cancel-started-confirm"}>
            {mode === "end" ? t("confirmEnd") : mode === "reassign" ? t("confirmReassign") : t("confirmCancel")}
          </Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}
