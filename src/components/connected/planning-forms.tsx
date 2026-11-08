"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { cancelAbsence, decideAbsence, previewAutoWindow, restoreAutoWindow, saveAbsence, setTaskTypeRule, setTaskWindow, setValidationTypes, updateMyProfile, type AutoWindowPreview } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Link } from "@/i18n/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";
import { durationText, fromLocalInput, localInputIn, periodText } from "@/lib/connected/format";

const TYPES = ["turnover", "maintenance", "linen_delivery", "linen_pickup", "inspection", "check_in", "check_out", "other"] as const;
const POSITIONS = ["housekeeper", "inspector", "maintenance", "laundry", "concierge", "driver", "chef", "other"] as const;

const localInput = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const today = () => localInput(new Date().toISOString()).slice(0, 10);

/** Réglage de validation : chaque type de mission, explicitement (appliqué par la base à la fin de la mission). */
export function ValidationSettings({ initial }: { initial: string[] }) {
  const t = useTranslations("connected.settings");
  const tt = useTranslations("taskType");
  const { pending, error, run } = useRun();
  const [types, setTypes] = useState<string[]>(initial);
  const [saved, setSaved] = useState(false);
  const dirty = [...types].sort().join() !== [...initial].sort().join();
  return (
    <Card className="p-5" data-testid="validation-settings">
      <h2 className="text-[17px] font-semibold">{t("validationTitle")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("validationText")}</p>
      <ul className="mt-4 divide-y divide-line">
        {TYPES.map((type) => {
          const on = types.includes(type);
          return (
            <li key={type} className="flex flex-wrap items-center gap-3 py-3">
              <span className="flex-1 text-[15px] font-medium">{tt(type)}</span>
              <div role="radiogroup" aria-label={tt(type)} className="flex rounded-md border border-line p-0.5 text-[13px]">
                {[true, false].map((v) => (
                  <button
                    key={String(v)}
                    type="button"
                    role="radio"
                    aria-checked={on === v}
                    onClick={() => {
                      setSaved(false);
                      setTypes(v ? [...types, type] : types.filter((x) => x !== type));
                    }}
                    className={cn("rounded px-3 py-1.5 font-medium", on === v ? "bg-accent text-white" : "text-muted hover:text-fg")}
                    data-testid={`validation-${type}-${v ? "on" : "off"}`}
                  >
                    {v ? t("needsValidation") : t("autoClose")}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex items-center gap-3">
        <Button onClick={() => run(() => setValidationTypes(types), () => setSaved(true))} disabled={pending || !dirty} data-testid="validation-save">
          {t("save")}
        </Button>
        {saved && !dirty && <span className="text-[14px] text-success" role="status">{t("saved")}</span>}
        {error && <span role="alert" className="text-[14px] text-danger">{error}</span>}
      </div>
    </Card>
  );
}

export type TaskTypeRule = { type: string; startRule: "firm" | "recommended"; checklistRequired: boolean; commentRequired: boolean };

/** Règles par type de mission : démarrage avant la plage, checklist et commentaire exigés pour terminer (appliqué par la base). */
export function TaskRuleSettings({ initial }: { initial: TaskTypeRule[] }) {
  const t = useTranslations("connected.taskRules");
  const tt = useTranslations("taskType");
  const { pending, error, run } = useRun();
  const [rules, setRules] = useState(initial);
  const [saved, setSaved] = useState<string | null>(null);
  const update = (type: string, patch: Partial<TaskTypeRule>) => {
    const next = rules.map((r) => (r.type === type ? { ...r, ...patch } : r));
    setRules(next);
    const r = next.find((x) => x.type === type)!;
    run(() => setTaskTypeRule(type, r), () => setSaved(type));
  };
  return (
    <Card className="p-5" data-testid="task-rules">
      <h2 className="text-[17px] font-semibold">{t("title")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      <ul className="mt-4 divide-y divide-line">
        {rules.map((r) => (
          <li key={r.type} className="space-y-2 py-3" data-testid={`rule-${r.type}`}>
            <p className="text-[15px] font-medium">
              {tt(r.type)} {saved === r.type && <span className="ms-2 text-[13px] font-normal text-success">{t("saved")}</span>}
            </p>
            <div className="flex flex-wrap gap-x-5 gap-y-2 text-[14px]">
              <label className="flex items-center gap-2">
                <span className="text-muted">{t("start")}</span>
                <Select value={r.startRule} disabled={pending} onChange={(e) => update(r.type, { startRule: e.target.value as "firm" | "recommended" })} data-testid={`rule-${r.type}-start`}>
                  <option value="firm">{t("firm")}</option>
                  <option value="recommended">{t("recommended")}</option>
                </Select>
              </label>
              {(r.type === "turnover" || r.type === "inspection") && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={r.checklistRequired} disabled={pending} onChange={(e) => update(r.type, { checklistRequired: e.target.checked })} data-testid={`rule-${r.type}-checklist`} />
                  {t("checklist")}
                </label>
              )}
              <label className="flex items-center gap-2">
                <input type="checkbox" checked={r.commentRequired} disabled={pending} onChange={(e) => update(r.type, { commentRequired: e.target.checked })} data-testid={`rule-${r.type}-comment`} />
                {t("comment")}
              </label>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-muted">{t("photosNote")}</p>
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </Card>
  );
}

/** Correction du créneau d'une mission par le responsable : fenêtre et durée séparées, motif tracé. */
export function WindowEditor({ taskId, start, end, durationMin, timeZone }: { taskId: string; start: string; end: string; durationMin: number; timeZone?: string }) {
  const t = useTranslations("connected.window");
  const { pending, error, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ start: localInputIn(new Date(start), timeZone), end: localInputIn(new Date(end), timeZone), duration: durationMin, reason: "" });
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} data-testid="window-edit">
        {t("edit")}
      </Button>
    );
  const fits = fromLocalInput(f.end, timeZone).getTime() >= fromLocalInput(f.start, timeZone).getTime() + f.duration * 60_000;
  return (
    <Card className="space-y-3 p-4" data-testid="window-editor">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("start")} htmlFor="w-start">
          <Input id="w-start" type="datetime-local" value={f.start} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, start: val })); }} data-testid="window-start" />
        </Field>
        <Field label={t("end")} htmlFor="w-end">
          <Input id="w-end" type="datetime-local" value={f.end} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, end: val })); }} data-testid="window-end" />
        </Field>
        <Field label={t("duration")} htmlFor="w-dur" hint={t("durationHint")}>
          <Input id="w-dur" type="number" min={5} max={1440} step={5} value={f.duration} onChange={(e) => setF({ ...f, duration: Number(e.target.value) })} data-testid="window-duration" />
        </Field>
        <Field label={t("reason")} htmlFor="w-reason">
          <Input id="w-reason" value={f.reason} maxLength={300} onChange={(e) => { const val = e.target.value; setF((prev) => ({ ...prev, reason: val })); }} data-testid="window-reason" />
        </Field>
      </div>
      {!fits && <p className="text-[13px] text-danger" role="alert">{t("tooShort")}</p>}
      <div className="flex gap-2">
        <Button size="sm" onClick={() => run(() => setTaskWindow(taskId, fromLocalInput(f.start, timeZone).toISOString(), fromLocalInput(f.end, timeZone).toISOString(), f.duration, f.reason), () => setOpen(false))} disabled={pending || !fits} data-testid="window-save">
          {t("save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </Card>
  );
}

/** Son propre profil : nom (obligatoire), téléphone (facultatif). Ne change aucun droit. */
export function ProfileForm({ name, phone }: { name: string; phone: string }) {
  const t = useTranslations("connected.profile");
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ name, phone });
  const [saved, setSaved] = useState(false);
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">{t("title")}</h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => updateMyProfile(f.name, f.phone), () => setSaved(true));
        }}
      >
        <Field label={t("name")} htmlFor="pf-name" hint={!f.name.trim() ? t("nameMissing") : undefined}>
          <Input id="pf-name" value={f.name} required maxLength={120} autoComplete="name" onChange={(e) => (setSaved(false), setF({ ...f, name: e.target.value }))} data-testid="profile-name" />
        </Field>
        <Field label={t("phone")} htmlFor="pf-phone" hint={!f.phone.trim() ? t("phoneMissing") : t("phoneHint")}>
          <Input id="pf-phone" type="tel" value={f.phone} maxLength={32} autoComplete="tel" onChange={(e) => (setSaved(false), setF({ ...f, phone: e.target.value }))} data-testid="profile-phone" />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending || !f.name.trim()} data-testid="profile-save">
            {t("save")}
          </Button>
          {saved && <span className="text-[14px] text-success" role="status">{t("saved")}</span>}
          {error && <span role="alert" className="text-[14px] text-danger">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

/**
 * Absence / indisponibilité / fermeture.
 * Responsable : pour une personne ou toute l'équipe (acceptée d'office).
 * Agent : pour lui-même, en attente de décision.
 */
export function AbsenceForm({ manager, members, selfId, timeZone = "Europe/Paris" }: { manager: boolean; members: { id: string; name: string }[]; selfId: string; timeZone?: string }) {
  const t = useTranslations("connected.absences");
  const tp = useTranslations("position");
  const { pending, error, run } = useRun();
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [done, setDone] = useState<string | null>(null);
  const [f, setF] = useState(() => ({
    who: manager ? members[0]?.id ?? "team" : selfId,
    position: "",
    kind: "leave" as "leave" | "unavailable" | "closure",
    allDay: true,
    from: today(),
    to: today(),
    start: localInputIn(new Date(), timeZone),
    end: localInputIn(new Date(Date.now() + 3 * 3_600_000), timeZone),
    unplanned: false,
    reason: "",
  }));
  const team = f.who === "team";
  const fd = useFormatter();
  // Jour civil tel que saisi (AAAA-MM-JJ), affiché sans conversion de fuseau
  const fmtDay = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? fd.dateTime(new Date(`${d}T12:00:00Z`), { dateStyle: "full", timeZone: "UTC" }) : "—");
  const period = () => {
    if (f.allDay) {
      const s = new Date(`${f.from}T00:00`);
      const e = new Date(`${f.to}T00:00`);
      e.setDate(e.getDate() + 1); // jusqu'à la fin du dernier jour, heure locale
      return { s, e };
    }
    return { s: fromLocalInput(f.start, timeZone), e: fromLocalInput(f.end, timeZone) };
  };
  const { s, e } = period();
  const valid = !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime()) && e > s;
  return (
    <Card className="p-5" data-testid="absence-form">
      <h2 className="text-[17px] font-semibold">{manager ? t("newTitle") : t("requestTitle")}</h2>
      <p className="mt-1 text-[14px] text-muted">{manager ? t("newText") : t("requestText")}</p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(ev) => {
          ev.preventDefault();
          // La date AFFICHÉE fait foi : relue dans le formulaire au moment de l'envoi (jamais une valeur d'état périmée)
          const el = ev.currentTarget.elements;
          const read = (name: string, fallback: string) => (el.namedItem(name) as HTMLInputElement | null)?.value ?? fallback;
          const g = { ...f, from: read("ab-from", f.from), to: read("ab-to", f.to), start: read("ab-start", f.start), end: read("ab-end", f.end) };
          const sAt = g.allDay ? new Date(`${g.from}T00:00`) : fromLocalInput(g.start, timeZone);
          const eAt = g.allDay ? (() => { const d = new Date(`${g.to}T00:00`); d.setDate(d.getDate() + 1); return d; })() : fromLocalInput(g.end, timeZone);
          if (Number.isNaN(sAt.getTime()) || Number.isNaN(eAt.getTime()) || eAt <= sAt) {
            setF(g);
            return;
          }
          run(
            () =>
              saveAbsence({
                clientId,
                scope: team ? "team" : "member",
                memberId: team ? null : g.who,
                kind: team ? "closure" : g.kind,
                startsAt: sAt.toISOString(),
                endsAt: eAt.toISOString(),
                unplanned: g.unplanned,
                reason: g.reason,
                teamPosition: team ? g.position || null : null,
                allDay: g.allDay ? { from: g.from, to: g.to } : undefined,
              }),
            (d) => {
              setDone(d.status);
              setClientId(crypto.randomUUID()); // la prochaine saisie est une nouvelle demande
              setF({ ...f, reason: "" });
            },
          );
        }}
      >
        {manager && (
          <Field label={t("who")} htmlFor="ab-who">
            <Select id="ab-who" value={f.who} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, who: val })); }} data-testid="absence-who">
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || t("noName")}
                </option>
              ))}
              <option value="team">{t("wholeTeam")}</option>
            </Select>
          </Field>
        )}
        {team ? (
          <Field label={t("position")} htmlFor="ab-pos" hint={t("positionHint")}>
            <Select id="ab-pos" value={f.position} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, position: val })); }}>
              <option value="">{t("allPositions")}</option>
              {POSITIONS.map((p) => (
                <option key={p} value={p}>
                  {tp(p)}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label={t("kind")} htmlFor="ab-kind">
            <Select id="ab-kind" value={f.kind} onChange={(ev) => setF({ ...f, kind: ev.target.value as "leave" | "unavailable" })} data-testid="absence-kind">
              <option value="leave">{t("kinds.leave")}</option>
              <option value="unavailable">{t("kinds.unavailable")}</option>
            </Select>
          </Field>
        )}
        <label className="flex items-center gap-2 text-[14px] sm:col-span-2">
          <input type="checkbox" checked={f.allDay} onChange={(ev) => setF({ ...f, allDay: ev.target.checked })} data-testid="absence-allday" />
          {t("allDay")}
        </label>
        {f.allDay ? (
          <>
            <Field label={t("from")} htmlFor="ab-from">
              <Input id="ab-from" name="ab-from" type="date" value={f.from} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, from: val, to: val > prev.to ? val : prev.to })); }} data-testid="absence-from" />
            </Field>
            <Field label={t("to")} htmlFor="ab-to">
              <Input id="ab-to" name="ab-to" type="date" value={f.to} min={f.from} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, to: val })); }} data-testid="absence-to" />
            </Field>
          </>
        ) : (
          <>
            <Field label={t("start")} htmlFor="ab-start">
              <Input id="ab-start" name="ab-start" type="datetime-local" value={f.start} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, start: val })); }} data-testid="absence-start" />
            </Field>
            <Field label={t("end")} htmlFor="ab-end">
              <Input id="ab-end" name="ab-end" type="datetime-local" value={f.end} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, end: val })); }} data-testid="absence-end" />
            </Field>
          </>
        )}
        <label className="flex items-center gap-2 text-[14px]">
          <input type="checkbox" checked={f.unplanned} onChange={(ev) => setF({ ...f, unplanned: ev.target.checked })} />
          {t("unplanned")}
        </label>
        <Field label={t("reason")} htmlFor="ab-reason" hint={t("reasonHint")} className="sm:col-span-2">
          <Input id="ab-reason" value={f.reason} maxLength={200} onChange={(ev) => { const val = ev.target.value; setF((prev) => ({ ...prev, reason: val })); }} data-testid="absence-reason" />
        </Field>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button type="submit" disabled={pending || !valid} data-testid="absence-save">
            {manager ? t("save") : t("request")}
          </Button>
          {!valid && <span className="text-[13px] text-danger" role="alert" data-testid="absence-invalid">{t("invalidPeriod")}</span>}
          {valid && (
            <span className="basis-full text-[13px] text-muted" data-testid="absence-summary">
              {f.allDay
                ? t("summaryDays", { from: fmtDay(f.from), to: fmtDay(f.to), same: f.from === f.to ? "yes" : "no" })
                : t("summaryHours", { from: fd.dateTime(s, { dateStyle: "full", timeStyle: "short", timeZone }), to: fd.dateTime(e, { dateStyle: "full", timeStyle: "short", timeZone }) })}
            </span>
          )}
          {done && (
            <span className="text-[14px] text-success" role="status" data-testid="absence-saved">
              {done === "pending" ? t("savedPending") : t("savedAccepted")}
            </span>
          )}
          {error && <span role="alert" className="text-[14px] text-danger">{error}</span>}
        </div>
      </form>
    </Card>
  );
}

export interface AbsenceRow {
  id: string;
  who: string;
  kind: "leave" | "unavailable" | "closure";
  startsAt: string;
  endsAt: string;
  status: "pending" | "accepted" | "refused" | "cancelled";
  unplanned: boolean;
  reason: string | null;
  canDecide: boolean;
  canCancel: boolean;
  /** Missions concernées (titre + lien), pour décider en connaissance de cause. */
  impacts: { id: string; label: string }[];
}

export function AbsenceList({ rows, empty }: { rows: AbsenceRow[]; empty: string }) {
  const t = useTranslations("connected.absences");
  const f = useFormatter();
  if (!rows.length) return <p className="text-[14px] text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <AbsenceItem key={r.id} r={r} t={t} period={periodText(f, r.startsAt, r.endsAt)} />
      ))}
    </ul>
  );
}

function AbsenceItem({ r, t, period }: { r: AbsenceRow; t: ReturnType<typeof useTranslations>; period: string }) {
  const { pending, error, run } = useRun();
  const tone = r.status === "pending" ? "text-warning" : r.status === "accepted" ? "text-fg" : "text-faint line-through";
  return (
    <li className="py-3" data-testid="absence-row" data-status={r.status}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex-1 text-[15px] font-medium">
          {r.who} · {t(`kinds.${r.kind}`)}
          {r.unplanned && <span className="ms-2 text-[12px] text-muted">({t("unplannedShort")})</span>}
        </span>
        <span className={cn("text-[13px] font-medium", tone)} data-testid="absence-status">
          {t(`status.${r.status}`)}
        </span>
      </div>
      <p className="text-[14px] text-muted">{period}</p>
      {r.reason && <p className="text-[13px] text-muted">« {r.reason} »</p>}
      {r.impacts.length > 0 && (
        <div className="mt-1 text-[13px]" data-testid="absence-impacts">
          <span className="font-medium text-danger">{t("impacts", { count: r.impacts.length })}</span>{" "}
          {r.impacts.map((i, n) => (
            <span key={i.id}>
              {n > 0 && " · "}
              <Link href={`/app/missions/${i.id}`} className="text-accent-text hover:underline">
                {i.label}
              </Link>
            </span>
          ))}
        </div>
      )}
      {(r.canDecide || r.canCancel) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.canDecide && (
            <>
              <Button size="sm" onClick={() => run(() => decideAbsence(r.id, true))} disabled={pending} data-testid="absence-accept">
                {t("accept")}
              </Button>
              <Button size="sm" variant="outline" onClick={() => run(() => decideAbsence(r.id, false))} disabled={pending} data-testid="absence-refuse">
                {t("refuse")}
              </Button>
            </>
          )}
          {r.canCancel && (
            <Button size="sm" variant="ghost" onClick={() => run(() => cancelAbsence(r.id))} disabled={pending} data-testid="absence-cancel">
              {t("cancel")}
            </Button>
          )}
        </div>
      )}
      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
    </li>
  );
}


/**
 * Revenir au calcul automatique : aperçu de la plage qui sera retenue (même moteur que la synchronisation
 * des séjours), avertissements, puis confirmation. Historisé avec son auteur ; ensuite, une modification
 * du séjour recalcule la plage.
 */
export function AutoWindowRestore({ taskId, timeZone }: { taskId: string; timeZone?: string }) {
  const t = useTranslations("connected.autoWindow");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [preview, setPreview] = useState<AutoWindowPreview | null>(null);
  const fmt = (s: string) => f.dateTime(new Date(s), { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) });
  const range = (w: { start: string; end: string; duration: number }) => t("range", { from: fmt(w.start), to: fmt(w.end), duration: durationText(w.duration) });
  return (
    <div className="mt-3 rounded-md border border-line p-3" data-testid="auto-window">
      {!preview ? (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => previewAutoWindow(taskId), (d) => setPreview(d))} data-testid="auto-window-preview">
          {t("open")}
        </Button>
      ) : !preview.possible ? (
        <p className="text-[14px]" role="status" data-testid="auto-window-impossible">{t("impossible")}</p>
      ) : (
        <div className="space-y-2 text-[14px]">
          <p>
            <span className="block text-[13px] text-muted">{t("current")}</span>
            <span data-testid="auto-window-current">{range(preview.current)}</span>
          </p>
          <p>
            <span className="block text-[13px] text-muted">{t("next")}</span>
            <span className="font-semibold" data-testid="auto-window-next">{range(preview.next!)}</span>
            {preview.same && <span className="block text-[13px] text-muted" data-testid="auto-window-same">{t("same")}</span>}
          </p>
          {preview.infeasible && <p className="rounded-md bg-danger-soft p-2 text-danger" role="alert" data-testid="auto-window-infeasible">{t("infeasible")}</p>}
          {preview.assigneeUnavailable && <p className="rounded-md bg-danger-soft p-2 text-danger" role="alert" data-testid="auto-window-unavailable">{t("unavailable")}</p>}
          {preview.assigneeAtRisk && <p className="rounded-md bg-warning-soft p-2" role="alert" data-testid="auto-window-risk">{t("risk")}</p>}
          <p className="text-[13px] text-muted">{t("effect")}</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending || preview.assigneeUnavailable} onClick={() => run(() => restoreAutoWindow(taskId, preview.next!))} data-testid="auto-window-confirm">
              {t("confirm")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => setPreview(null)}>
              {t("cancel")}
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-[14px] text-danger">{error}</p>}
    </div>
  );
}
