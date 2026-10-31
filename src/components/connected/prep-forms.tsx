"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Eye, EyeOff, Trash2, X } from "lucide-react";
import {
  addGuestItem,
  addPrepAction,
  createPrepMission,
  createPrepService,
  decideVip,
  deleteGuestItem,
  grantVip,
  revokeVip,
  saveVipCriterion,
  setGuestItemPublished,
  setPrepQuestions,
  setPrepActionStatus,
  setPrepStatus,
  type PrepActionInput,
} from "@/lib/connected/actions";
import { zonedTime } from "@/lib/connected/format";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

const PREP_STATUSES = ["to_prepare", "in_progress", "waiting_guest", "ready"] as const;

export function PrepStatusControl({ reservationId, status, openBlocking }: { reservationId: string; status: string; openBlocking: number }) {
  const t = useTranslations("connected.prep");
  const { pending, error, run } = useRun();
  if (status === "cancelled") return <p className="text-[14px] font-medium text-danger" data-testid="prep-status" data-status="cancelled">{t("status.cancelled")}</p>;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={t("statusLabel")} data-testid="prep-status" data-status={status}>
        {PREP_STATUSES.map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === status ? "primary" : "outline"}
            aria-pressed={s === status}
            disabled={pending}
            onClick={() => s !== status && run(() => setPrepStatus(reservationId, s))}
            data-testid={`prep-status-${s}`}
          >
            {t(`status.${s}`)}
          </Button>
        ))}
      </div>
      {openBlocking > 0 && <p className="text-[13px] text-warning">{t("blockingHint", { count: openBlocking })}</p>}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}

export interface PrepActionRow {
  id: string;
  title: string;
  kind: PrepActionInput["kind"];
  assignee_id: string | null;
  due_at: string | null;
  blocking: boolean;
  status: "open" | "done" | "cancelled";
  task_id: string | null;
  service_id: string | null;
  done_at: string | null;
  override_reason?: string | null;
  /** Statut de la mission liée (si l'action a donné lieu à une mission) */
  task_status?: string | null;
}

export function PrepActions({
  reservationId,
  actions,
  members,
  timeZone,
  serviceKinds,
  checkIn,
}: {
  reservationId: string;
  actions: PrepActionRow[];
  members: { id: string; name: string }[];
  timeZone: string;
  serviceKinds: string[];
  checkIn: string;
}) {
  const t = useTranslations("connected.prep");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [n, setN] = useState({ title: "", kind: "other" as PrepActionInput["kind"], assignee: "", due: "", blocking: false });
  const [open, setOpen] = useState<{ id: string; mode: "service" | "task" | "force" } | null>(null);
  const [force, setForce] = useState("");
  const tts = useTranslations("taskStatus");
  const name = (id: string | null) => members.find((m) => m.id === id)?.name ?? t("unassigned");
  const fmt = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short", timeZone });
  return (
    <div className="space-y-3" data-testid="prep-actions">
      {actions.length === 0 && <p className="text-[14px] text-muted">{t("noActions")}</p>}
      <ul className="space-y-2">
        {actions.map((a) => (
          <li key={a.id} className={cn("rounded-md border border-line p-3", a.status !== "open" && "opacity-70")} data-testid="prep-action" data-status={a.status} data-blocking={a.blocking ? "1" : "0"}>
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
              <span className={cn("flex-1", a.status === "done" && "line-through")}>{a.title}</span>
              {a.blocking && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[12px] font-semibold text-warning">{t("blocking")}</span>}
              <span className="text-[12px] text-muted">{t(`actionStatus.${a.status}`)}</span>
            </p>
            <p className="mt-1 text-[13px] text-muted">
              {t(`kind.${a.kind}`)} · {name(a.assignee_id)}
              {a.due_at ? ` · ${t("dueOn", { date: fmt(a.due_at) })}` : ""}
              {a.service_id ? ` · ${t("linkedService")}` : ""}
              {a.task_id ? ` · ${t("linkedTask")}${a.task_status ? ` (${tts(a.task_status)})` : ""}` : ""}
            </p>
            {a.status === "open" && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() => (a.task_id && a.task_status && !["done", "validated", "cancelled"].includes(a.task_status) ? setOpen({ id: a.id, mode: "force" }) : run(() => setPrepActionStatus(a.id, "done")))}
                  data-testid="prep-action-done"
                >
                  <Check />
                  {t("markDone")}
                </Button>
                {!a.service_id && (
                  <Button size="sm" variant="ghost" onClick={() => setOpen({ id: a.id, mode: "service" })} data-testid="prep-action-service">
                    {t("createService")}
                  </Button>
                )}
                {!a.task_id && (
                  <Button size="sm" variant="ghost" onClick={() => setOpen({ id: a.id, mode: "task" })} data-testid="prep-action-task">
                    {t("createTask")}
                  </Button>
                )}
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setPrepActionStatus(a.id, "cancelled"))}>
                  <X />
                  {t("cancelAction")}
                </Button>
              </div>
            )}
            {a.status !== "open" && (
              <Button size="sm" variant="ghost" className="mt-1" disabled={pending} onClick={() => run(() => setPrepActionStatus(a.id, "open"))}>
                {t("reopen")}
              </Button>
            )}
            {a.status === "done" && a.override_reason && <p className="mt-1 text-[13px] text-warning" data-testid="prep-action-override">{t("overrideShown", { reason: a.override_reason })}</p>}
            {open?.id === a.id && open.mode === "force" && (
              <div className="mt-3 space-y-2 rounded-md border border-warning bg-warning-soft p-3" data-testid="prep-force">
                <p className="text-[14px]">{t("missionNotDone")}</p>
                <Field label={t("overrideReason")} htmlFor={`pf-${a.id}`}>
                  <Input id={`pf-${a.id}`} value={force} maxLength={500} onChange={(e) => setForce(e.target.value)} data-testid="prep-force-reason" />
                </Field>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setOpen(null)}>
                    {t("close")}
                  </Button>
                  <Button size="sm" variant="outline" disabled={pending || !force.trim()} onClick={() => run(() => setPrepActionStatus(a.id, "done", force), () => (setOpen(null), setForce("")))} data-testid="prep-force-confirm">
                    {t("overrideConfirm")}
                  </Button>
                </div>
              </div>
            )}
            {open?.id === a.id && open.mode === "service" && (
              <ServiceFromAction reservationId={reservationId} actionId={a.id} kinds={serviceKinds} timeZone={timeZone} title={a.title} onDone={() => setOpen(null)} />
            )}
            {open?.id === a.id && open.mode === "task" && (
              <TaskFromAction reservationId={reservationId} actionId={a.id} timeZone={timeZone} title={a.title} checkIn={checkIn} onDone={() => setOpen(null)} />
            )}
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 rounded-md border border-dashed border-line p-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addPrepAction(reservationId, { title: n.title, kind: n.kind, assigneeId: n.assignee || null, dueAt: n.due ? zonedTime(n.due, timeZone).toISOString() : null, blocking: n.blocking }),
            () => setN({ title: "", kind: "other", assignee: "", due: "", blocking: false }),
          );
        }}
      >
        <Field label={t("newAction")} htmlFor="pa-title" className="sm:col-span-2">
          <Input id="pa-title" value={n.title} maxLength={200} onChange={(e) => setN({ ...n, title: e.target.value })} placeholder={t("newActionPlaceholder")} data-testid="prep-action-title" />
        </Field>
        <Field label={t("kindLabel")} htmlFor="pa-kind">
          <Select id="pa-kind" value={n.kind} onChange={(e) => setN({ ...n, kind: e.target.value as PrepActionInput["kind"] })}>
            {(["task", "service", "info", "message", "vip", "other"] as const).map((k) => (
              <option key={k} value={k}>
                {t(`kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("owner")} htmlFor="pa-owner">
          <Select id="pa-owner" value={n.assignee} onChange={(e) => setN({ ...n, assignee: e.target.value })} data-testid="prep-action-owner">
            <option value="">{t("unassigned")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("due")} htmlFor="pa-due" hint={t("localTimeHint")}>
          <Input id="pa-due" type="datetime-local" value={n.due} onChange={(e) => setN({ ...n, due: e.target.value })} data-testid="prep-action-due" />
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-[14px]">
          <input type="checkbox" className="size-4" checked={n.blocking} onChange={(e) => setN({ ...n, blocking: e.target.checked })} data-testid="prep-action-blocking" />
          {t("blockingLabel")}
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          <Button type="submit" size="sm" className="ms-auto" disabled={pending || !n.title.trim()} data-testid="prep-action-add">
            {t("addAction")}
          </Button>
        </div>
      </form>
    </div>
  );
}

function ServiceFromAction({ reservationId, actionId, kinds, timeZone, title, onDone }: { reservationId: string; actionId: string; kinds: string[]; timeZone: string; title: string; onDone: () => void }) {
  const t = useTranslations("connected.prep");
  const tk = useTranslations("serviceKind");
  const { pending, error, run } = useRun();
  const [v, setV] = useState({ kind: kinds[0] ?? "other", when: "", people: 2, details: title });
  return (
    <form
      className="mt-3 grid gap-3 rounded-md bg-subtle p-3 sm:grid-cols-2 dark:bg-surface-hover"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createPrepService(reservationId, actionId, { kind: v.kind, startAt: zonedTime(v.when, timeZone).toISOString(), people: v.people, details: v.details }), onDone);
      }}
      data-testid="prep-service-form"
    >
      <Field label={t("serviceKind")} htmlFor={`ps-k-${actionId}`}>
        <Select id={`ps-k-${actionId}`} value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {tk(k)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("serviceWhen")} htmlFor={`ps-w-${actionId}`} hint={t("localTimeHint")}>
        <Input id={`ps-w-${actionId}`} type="datetime-local" value={v.when} onChange={(e) => setV({ ...v, when: e.target.value })} required />
      </Field>
      <Field label={t("servicePeople")} htmlFor={`ps-p-${actionId}`}>
        <Input id={`ps-p-${actionId}`} type="number" min={1} max={100} value={v.people} onChange={(e) => setV({ ...v, people: Number(e.target.value) })} />
      </Field>
      <Field label={t("serviceDetails")} htmlFor={`ps-d-${actionId}`}>
        <Input id={`ps-d-${actionId}`} value={v.details} maxLength={2000} onChange={(e) => setV({ ...v, details: e.target.value })} />
      </Field>
      <p className="text-[13px] text-muted sm:col-span-2">{t("serviceHint")}</p>
      <div className="flex gap-2 sm:col-span-2">
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        <Button type="button" variant="ghost" size="sm" className="ms-auto" onClick={onDone}>
          {t("close")}
        </Button>
        <Button type="submit" size="sm" disabled={pending || !v.when} data-testid="prep-service-create">
          {t("createService")}
        </Button>
      </div>
    </form>
  );
}

function TaskFromAction({ reservationId, actionId, timeZone, title, checkIn, onDone }: { reservationId: string; actionId: string; timeZone: string; title: string; checkIn: string; onDone: () => void }) {
  const t = useTranslations("connected.prep");
  const { pending, error, run } = useRun();
  const local = (x: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(x).replace(" ", "T");
  const [v, setV] = useState({ title, notes: "", start: "", end: local(new Date(checkIn)), duration: 30 });
  return (
    <form
      className="mt-3 grid gap-3 rounded-md bg-subtle p-3 sm:grid-cols-2 dark:bg-surface-hover"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => createPrepMission(reservationId, actionId, { title: v.title, notes: v.notes, start: zonedTime(v.start, timeZone).toISOString(), end: zonedTime(v.end, timeZone).toISOString(), durationMin: v.duration }), onDone);
      }}
      data-testid="prep-task-form"
    >
      <Field label={t("taskTitle")} htmlFor={`pt-t-${actionId}`} className="sm:col-span-2">
        <Input id={`pt-t-${actionId}`} value={v.title} maxLength={200} onChange={(e) => setV({ ...v, title: e.target.value })} />
      </Field>
      <Field label={t("taskNotes")} htmlFor={`pt-n-${actionId}`} hint={t("taskNotesHint")} className="sm:col-span-2">
        <Textarea id={`pt-n-${actionId}`} value={v.notes} maxLength={4000} onChange={(e) => setV({ ...v, notes: e.target.value })} data-testid="prep-task-notes" />
      </Field>
      <Field label={t("taskFrom")} htmlFor={`pt-s-${actionId}`} hint={t("localTimeHint")}>
        <Input id={`pt-s-${actionId}`} type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} required />
      </Field>
      <Field label={t("taskTo")} htmlFor={`pt-e-${actionId}`}>
        <Input id={`pt-e-${actionId}`} type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} required />
      </Field>
      <Field label={t("taskDuration")} htmlFor={`pt-d-${actionId}`}>
        <Input id={`pt-d-${actionId}`} type="number" min={5} max={1440} value={v.duration} onChange={(e) => setV({ ...v, duration: Number(e.target.value) })} />
      </Field>
      <p className="self-end text-[13px] text-muted">{t("taskHint")}</p>
      <div className="flex gap-2 sm:col-span-2">
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
        <Button type="button" variant="ghost" size="sm" className="ms-auto" onClick={onDone}>
          {t("close")}
        </Button>
        <Button type="submit" size="sm" disabled={pending || !v.start || !v.end} data-testid="prep-task-create">
          {t("createTask")}
        </Button>
      </div>
    </form>
  );
}

export interface GuestItemRow {
  id: string;
  kind: "recommendation" | "info";
  title: string;
  body: string | null;
  url: string | null;
  place_id: string | null;
  published_at: string | null;
}

export function GuestItems({ reservationId, items, places, timeZone }: { reservationId: string; items: GuestItemRow[]; places: { id: string; name: string }[]; timeZone: string }) {
  const t = useTranslations("connected.prep");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [v, setV] = useState({ kind: "recommendation" as GuestItemRow["kind"], title: "", body: "", url: "", place: "", publish: true });
  return (
    <div className="space-y-3" data-testid="prep-items">
      {items.length === 0 && <p className="text-[14px] text-muted">{t("noItems")}</p>}
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.id} className="rounded-md border border-line p-3" data-testid="prep-item" data-published={it.published_at ? "1" : "0"}>
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
              <span className="flex-1">{it.title}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[12px] font-semibold", it.published_at ? "bg-success-soft text-success" : "bg-subtle text-muted")}>
                {it.published_at ? t("publishedOn", { date: f.dateTime(new Date(it.published_at), { dateStyle: "medium", timeStyle: "short", timeZone }) }) : t("draft")}
              </span>
            </p>
            <p className="text-[13px] text-muted">{t(`itemKind.${it.kind}`)}{it.place_id ? ` · ${places.find((p) => p.id === it.place_id)?.name ?? ""}` : ""}</p>
            {it.body && <p className="mt-1 whitespace-pre-wrap text-[14px]">{it.body}</p>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => setGuestItemPublished(it.id, !it.published_at))} data-testid="prep-item-toggle">
                {it.published_at ? <EyeOff /> : <Eye />}
                {it.published_at ? t("unpublish") : t("publish")}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteGuestItem(it.id))}>
                <Trash2 />
                {t("delete")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      <form
        className="grid gap-3 rounded-md border border-dashed border-line p-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () => addGuestItem(reservationId, { kind: v.kind, title: v.title, body: v.body, url: v.url, placeId: v.place || null, publish: v.publish }),
            () => setV({ ...v, title: "", body: "", url: "", place: "" }),
          );
        }}
      >
        <Field label={t("itemKindLabel")} htmlFor="gi-kind">
          <Select id="gi-kind" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value as GuestItemRow["kind"] })}>
            <option value="recommendation">{t("itemKind.recommendation")}</option>
            <option value="info">{t("itemKind.info")}</option>
          </Select>
        </Field>
        <Field label={t("itemPlace")} htmlFor="gi-place">
          <Select
            id="gi-place"
            value={v.place}
            onChange={(e) => {
              const p = places.find((x) => x.id === e.target.value);
              setV({ ...v, place: e.target.value, title: v.title || p?.name || "" });
            }}
          >
            <option value="">{t("noPlace")}</option>
            {places.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("itemTitle")} htmlFor="gi-title" className="sm:col-span-2">
          <Input id="gi-title" value={v.title} maxLength={160} onChange={(e) => setV({ ...v, title: e.target.value })} data-testid="prep-item-title" />
        </Field>
        <Field label={t("itemBody")} htmlFor="gi-body" className="sm:col-span-2">
          <Textarea id="gi-body" value={v.body} maxLength={1000} onChange={(e) => setV({ ...v, body: e.target.value })} data-testid="prep-item-body" />
        </Field>
        <Field label={t("itemUrl")} htmlFor="gi-url">
          <Input id="gi-url" type="url" value={v.url} maxLength={300} onChange={(e) => setV({ ...v, url: e.target.value })} placeholder="https://" />
        </Field>
        <label className="flex min-h-11 items-center gap-2 self-end text-[14px]">
          <input type="checkbox" className="size-4" checked={v.publish} onChange={(e) => setV({ ...v, publish: e.target.checked })} data-testid="prep-item-publish" />
          {t("publishNow")}
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          <Button type="submit" size="sm" className="ms-auto" disabled={pending || !v.title.trim()} data-testid="prep-item-add">
            {t("addItem")}
          </Button>
        </div>
      </form>
    </div>
  );
}

export interface VipState {
  status: "active" | "revoked" | null;
  expired: boolean;
  criterion: string | null;
  reason: string | null;
  grantedBy: string | null;
  grantedAt: string | null;
  expiresAt: string | null;
}

export function VipPanel({
  reservationId,
  vip,
  request,
  criteria,
  loyalty,
  timeZone,
  delivery,
}: {
  reservationId: string;
  /** État réel du dernier e-mail « réponse VIP » au voyageur (journal d'envoi) */
  delivery?: { status: string; at: string } | null;
  vip: VipState;
  request: { id: string; status: string; note: string | null; criterion_id: string | null; guest_message: string | null; created_at: string } | null;
  criteria: { id: string; label: string; kind: string; min_stays: number | null; validity_days: number | null }[];
  loyalty: number | null;
  timeZone: string;
}) {
  const t = useTranslations("connected.vip");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const fmt = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short", timeZone });
  const [crit, setCrit] = useState(request?.criterion_id ?? criteria[0]?.id ?? "");
  const validity = criteria.find((c) => c.id === crit)?.validity_days;
  const [expires, setExpires] = useState("");
  const [guestMsg, setGuestMsg] = useState("");
  const [internal, setInternal] = useState("");
  const [why, setWhy] = useState("");
  const active = vip.status === "active" && !vip.expired;
  const exp = () => (expires ? zonedTime(`${expires}T23:59`, timeZone).toISOString() : validity ? new Date(Date.now() + validity * 86_400_000).toISOString() : null);
  const openReq = request && (request.status === "pending" || request.status === "info_requested");
  return (
    <div className="space-y-4" data-testid="vip-panel" data-vip={active ? "active" : vip.status ?? "none"}>
      <div className="rounded-md bg-subtle p-3 text-[14px] dark:bg-surface-hover">
        {active ? (
          <p data-testid="vip-state">
            <span className="font-semibold text-success">{t("active")}</span>
            {vip.criterion ? ` · ${vip.criterion}` : ""}
            {vip.grantedAt ? ` · ${t("grantedBy", { who: vip.grantedBy ?? "—", date: fmt(vip.grantedAt) })}` : ""}
            {vip.expiresAt ? ` · ${t("expiresOn", { date: fmt(vip.expiresAt) })}` : ` · ${t("noExpiry")}`}
          </p>
        ) : (
          <p data-testid="vip-state">{vip.status === "active" && vip.expired ? t("expired") : vip.status === "revoked" ? t("revoked") : t("none")}</p>
        )}
        {vip.reason && <p className="mt-1 text-muted">{t("reason", { reason: vip.reason })}</p>}
        {loyalty !== null && <p className="mt-1 text-muted" data-testid="vip-loyalty">{t("loyalty", { count: loyalty })}</p>}
        <p className="mt-1 text-[12px] text-faint">{t("privacy")}</p>
      </div>

      {request && !openReq && request.guest_message && (
        <div className="rounded-md border border-line p-3 text-[14px]" data-testid="vip-sent-message">
          <p className="text-[12px] font-medium text-muted">{t("sentToGuest")}</p>
          <p className="mt-1 whitespace-pre-wrap">« {request.guest_message} »</p>
          <p className="mt-1 text-[12px] text-muted" data-testid="vip-sent-delivery">
            {t("visibleInSpace")}
            {delivery ? ` · ${t(`delivery.${["sent", "pending", "failed", "not_configured"].includes(delivery.status) ? delivery.status : "failed"}`)} (${fmt(delivery.at)})` : ` · ${t("delivery.none")}`}
          </p>
        </div>
      )}

      {openReq && (
        <div className="space-y-3 rounded-md border border-accent p-3" data-testid="vip-request">
          <p className="text-[15px] font-medium">{request.status === "pending" ? t("requestPending", { date: fmt(request.created_at) }) : t("requestInfo")}</p>
          {request.note && <p className="whitespace-pre-wrap text-[14px]">« {request.note} »</p>}
          {request.status === "info_requested" && request.guest_message && <p className="text-[13px] text-muted">{t("yourQuestion", { q: request.guest_message })}</p>}
          <CriterionFields criteria={criteria} crit={crit} setCrit={setCrit} expires={expires} setExpires={setExpires} validity={validity} />
          <Field label={t("guestMessage")} htmlFor="vip-gm" hint={t("guestMessageHint")}>
            <Textarea id="vip-gm" value={guestMsg} maxLength={1000} onChange={(e) => setGuestMsg(e.target.value)} data-testid="vip-guest-msg" />
          </Field>
          <Field label={t("internal")} htmlFor="vip-in" hint={t("internalHint")}>
            <Input id="vip-in" value={internal} maxLength={1000} onChange={(e) => setInternal(e.target.value)} data-testid="vip-internal" />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => run(() => decideVip(request.id, "accept", { criterionId: crit || null, expiresAt: exp(), guestMessage: guestMsg, internalNote: internal }))} data-testid="vip-accept">
              {t("accept")}
            </Button>
            <Button size="sm" variant="outline" disabled={pending || !guestMsg.trim()} onClick={() => run(() => decideVip(request.id, "info", { criterionId: null, expiresAt: null, guestMessage: guestMsg, internalNote: internal }))} data-testid="vip-info">
              {t("askInfo")}
            </Button>
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => decideVip(request.id, "refuse", { criterionId: null, expiresAt: null, guestMessage: guestMsg, internalNote: internal }))} data-testid="vip-refuse">
              {t("refuse")}
            </Button>
          </div>
        </div>
      )}

      {!openReq && !active && (
        <div className="space-y-3" data-testid="vip-grant">
          <p className="text-[14px] text-muted">{t("grantText")}</p>
          <CriterionFields criteria={criteria} crit={crit} setCrit={setCrit} expires={expires} setExpires={setExpires} validity={validity} />
          <Field label={t("why")} htmlFor="vip-why" hint={t("whyHint")}>
            <Input id="vip-why" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} data-testid="vip-why" />
          </Field>
          <Button size="sm" variant="outline" disabled={pending || (!crit && !why.trim())} onClick={() => run(() => grantVip(reservationId, crit || null, exp(), why), () => setWhy(""))} data-testid="vip-grant-btn">
            {t("grant")}
          </Button>
        </div>
      )}

      {active && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={t("revokeWhy")} htmlFor="vip-rw" className="min-w-56 flex-1">
            <Input id="vip-rw" value={why} maxLength={500} onChange={(e) => setWhy(e.target.value)} />
          </Field>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => revokeVip(reservationId, why), () => setWhy(""))} data-testid="vip-revoke">
            {t("revoke")}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
    </div>
  );
}

function CriterionFields({
  criteria,
  crit,
  setCrit,
  expires,
  setExpires,
  validity,
}: {
  criteria: { id: string; label: string }[];
  crit: string;
  setCrit: (v: string) => void;
  expires: string;
  setExpires: (v: string) => void;
  validity: number | null | undefined;
}) {
  const t = useTranslations("connected.vip");
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label={t("criterion")} htmlFor="vip-crit">
        <Select id="vip-crit" value={crit} onChange={(e) => setCrit(e.target.value)} data-testid="vip-criterion">
          <option value="">{t("noCriterion")}</option>
          {criteria.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("expires")} htmlFor="vip-exp" hint={validity ? t("validityDefault", { days: validity }) : t("expiresHint")}>
        <Input id="vip-exp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} />
      </Field>
    </div>
  );
}

const QUESTIONS = ["guests", "interests", "style", "services", "budget", "constraints", "other", "language"] as const;

/** Questions proposées aux voyageurs (toutes facultatives pour eux). */
export function PrepQuestionsSettings({ initial }: { initial: string[] }) {
  const t = useTranslations("connected.settings.prep");
  const { pending, error, run } = useRun();
  const [on, setOn] = useState<string[]>(initial);
  const [saved, setSaved] = useState(false);
  const dirty = [...on].sort().join() !== [...initial].sort().join();
  return (
    <div className="space-y-3" data-testid="prep-settings">
      <ul className="grid gap-2 sm:grid-cols-2">
        {QUESTIONS.map((q) => (
          <li key={q}>
            <label className="flex min-h-11 items-center gap-2 rounded-md border border-line px-3 text-[14px]">
              <input
                type="checkbox"
                className="size-4"
                checked={on.includes(q)}
                onChange={(e) => (setSaved(false), setOn(e.target.checked ? [...on, q] : on.filter((x) => x !== q)))}
                data-testid={`prep-q-${q}`}
              />
              {t(`q.${q}`)}
            </label>
          </li>
        ))}
      </ul>
      {on.length === 0 && <p className="text-[13px] text-warning">{t("noneHint")}</p>}
      <div className="flex items-center gap-3">
        <Button onClick={() => run(() => setPrepQuestions(on), () => setSaved(true))} disabled={pending || !dirty} data-testid="prep-q-save">
          {t("save")}
        </Button>
        {saved && <p role="status" className="text-[14px] text-success">{t("saved")}</p>}
        {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
      </div>
    </div>
  );
}

export interface CriterionRow {
  id: string;
  label: string;
  kind: "loyalty" | "premium" | "partner" | "manual";
  min_stays: number | null;
  validity_days: number | null;
  guest_visible: boolean;
  editable_by: "owner" | "manager";
  active: boolean;
}

/** Critères VIP de l'organisation : toujours validés par une personne, jamais attribués seuls. */
export function VipCriteriaSettings({ criteria, isOwner }: { criteria: CriterionRow[]; isOwner: boolean }) {
  const t = useTranslations("connected.settings.vip");
  const blank: CriterionRow = { id: "", label: "", kind: "manual", min_stays: null, validity_days: null, guest_visible: true, editable_by: "manager", active: true };
  const [edit, setEdit] = useState<CriterionRow | null>(null);
  const { pending, error, run } = useRun();
  const save = (c: CriterionRow) =>
    run(
      () => saveVipCriterion({ id: c.id || null, label: c.label, kind: c.kind, minStays: c.min_stays, validityDays: c.validity_days, guestVisible: c.guest_visible, editableBy: c.editable_by, active: c.active }),
      () => setEdit(null),
    );
  return (
    <div className="space-y-3" data-testid="vip-settings">
      <ul className="divide-y divide-line">
        {criteria.length === 0 && <li className="py-2 text-[14px] text-muted">{t("empty")}</li>}
        {criteria.map((c) => {
          const locked = c.editable_by === "owner" && !isOwner;
          return (
            <li key={c.id} className="flex flex-wrap items-center gap-2 py-2.5" data-testid="vip-criterion-row">
              <span className="min-w-0 flex-1">
                <span className={cn("block text-[15px] font-medium", !c.active && "text-muted line-through")}>{c.label}</span>
                <span className="block text-[13px] text-muted">
                  {t(`kind.${c.kind}`)}
                  {c.kind === "loyalty" && c.min_stays ? ` · ${t("minStaysValue", { n: c.min_stays })}` : ""}
                  {c.validity_days ? ` · ${t("validityValue", { n: c.validity_days })}` : ` · ${t("noValidity")}`}
                  {` · ${c.guest_visible ? t("visible") : t("hidden")}`}
                  {` · ${t(`editableBy.${c.editable_by}`)}`}
                </span>
              </span>
              <Button size="sm" variant="ghost" disabled={locked} title={locked ? t("ownerOnly") : undefined} onClick={() => setEdit(c)}>
                {t("edit")}
              </Button>
            </li>
          );
        })}
      </ul>
      {!edit && (
        <Button size="sm" variant="outline" onClick={() => setEdit(blank)} data-testid="vip-criterion-new">
          {t("add")}
        </Button>
      )}
      {edit && (
        <form
          className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save(edit);
          }}
          data-testid="vip-criterion-form"
        >
          <Field label={t("label")} htmlFor="vc-label" className="sm:col-span-2">
            <Input id="vc-label" value={edit.label} maxLength={120} onChange={(e) => setEdit({ ...edit, label: e.target.value })} data-testid="vip-criterion-label" />
          </Field>
          <Field label={t("kindLabel")} htmlFor="vc-kind">
            <Select id="vc-kind" value={edit.kind} onChange={(e) => setEdit({ ...edit, kind: e.target.value as CriterionRow["kind"] })}>
              {(["loyalty", "premium", "partner", "manual"] as const).map((k) => (
                <option key={k} value={k}>
                  {t(`kind.${k}`)}
                </option>
              ))}
            </Select>
          </Field>
          {edit.kind === "loyalty" ? (
            <Field label={t("minStays")} htmlFor="vc-min" hint={t("minStaysHint")}>
              <Input id="vc-min" type="number" min={1} max={100} value={edit.min_stays ?? ""} onChange={(e) => setEdit({ ...edit, min_stays: e.target.value ? Number(e.target.value) : null })} />
            </Field>
          ) : (
            <p className="self-end text-[13px] text-muted">{t(`kindHint.${edit.kind}`)}</p>
          )}
          <Field label={t("validity")} htmlFor="vc-val" hint={t("validityHint")}>
            <Input id="vc-val" type="number" min={1} max={3650} value={edit.validity_days ?? ""} onChange={(e) => setEdit({ ...edit, validity_days: e.target.value ? Number(e.target.value) : null })} />
          </Field>
          <Field label={t("editableByLabel")} htmlFor="vc-ed" hint={isOwner ? undefined : t("ownerOnlyHint")}>
            <Select id="vc-ed" value={edit.editable_by} disabled={!isOwner} onChange={(e) => setEdit({ ...edit, editable_by: e.target.value as CriterionRow["editable_by"] })}>
              <option value="manager">{t("editableBy.manager")}</option>
              <option value="owner">{t("editableBy.owner")}</option>
            </Select>
          </Field>
          <label className="flex min-h-11 items-center gap-2 text-[14px]">
            <input type="checkbox" className="size-4" checked={edit.guest_visible} onChange={(e) => setEdit({ ...edit, guest_visible: e.target.checked })} />
            {t("guestVisible")}
          </label>
          <label className="flex min-h-11 items-center gap-2 text-[14px]">
            <input type="checkbox" className="size-4" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} />
            {t("active")}
          </label>
          <p className="text-[13px] text-muted sm:col-span-2">{t("validationAlways")}</p>
          <div className="flex items-center gap-2 sm:col-span-2">
            {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
            <Button type="button" variant="ghost" size="sm" className="ms-auto" onClick={() => setEdit(null)}>
              {t("cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={pending || !edit.label.trim()} data-testid="vip-criterion-save">
              {t("save")}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
