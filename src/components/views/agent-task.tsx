"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, Camera, Check, ChevronDown, KeyRound, Navigation, Play, Siren, Square, Timer } from "lucide-react";
import type { ChecklistRoom, RoomStatus, Task } from "@/lib/domain/types";
import { formatDuration } from "@/lib/engine/learning";
import { formatLocalTime } from "@/lib/engine/time";
import { Link, useRouter } from "@/i18n/navigation";
import { useHalo } from "@/lib/store/halo-store";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { EmptyState } from "@/components/halo/empty-state";
import { GuestBadges } from "@/components/halo/guest-badges";
import { AddPhotoButton, PhotoThumb } from "@/components/halo/photo-thumb";
import { ReadyGate } from "@/components/halo/ready-gate";
import { ReportSheet } from "@/components/halo/report-sheet";
import { StatusPill } from "@/components/halo/status-pill";
import { directionsUrl, useDeadlineLabel } from "@/components/halo/task-card";
import { DurationCompare, ROOM_STATUSES, ROOM_STATUS_META } from "@/components/halo/task-report";
import { TASK_TYPE_META, TaskTypeIcon } from "@/components/halo/task-type";
import { TaskLinenKit } from "@/components/linen/task-linen-kit";
import { cn } from "@/lib/utils";

function vibrate(ms: number) {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* non supporté */
  }
}

export function AgentTask({ taskId }: { taskId: string }) {
  return (
    <ReadyGate rows={3}>
      <AgentTaskInner taskId={taskId} />
    </ReadyGate>
  );
}

/** Chronomètre de la mission en cours (hh:mm:ss). */
function useElapsed(startedAt: string | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [running]);
  if (!startedAt) return 0;
  return Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
}

const clock = (s: number) =>
  [Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, "0")).join(":");

function AgentTaskInner({ taskId }: { taskId: string }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const task = useHalo((s) => s.tasks.find((x) => x.id === taskId));
  const property = useHalo((s) => (task ? s.properties.find((p) => p.id === task.propertyId) : undefined));
  const me = useHalo((s) => s.members.find((m) => m.id === s.currentAgentId));
  const deadline = useDeadlineLabel();
  const [reporting, setReporting] = useState(false);
  const [confirmUnchecked, setConfirmUnchecked] = useState(false);

  const started = task?.status === "in_progress";
  const elapsed = useElapsed(task?.startedAt, started);

  if (!task || !property) {
    return (
      <>
        <BackLink />
        <EmptyState icon={Square} title={t("mission.notFound")} />
      </>
    );
  }

  const finished = task.status === "done" || task.status === "validated";
  const canStart = task.status === "assigned" || task.status === "unassigned" || task.status === "to_redo";
  const report = task.report;
  const items = property.checklist.flatMap((r) => r.items);
  const checkedCount = items.filter((i) => report?.checked.includes(i.id)).length;
  const missingPhotos = items.filter((i) => i.photoRequired && !(report?.photos[i.id]?.length));
  const unchecked = items.length - checkedCount;
  const estimatedSec = task.durationMin * 60;
  const progress = Math.min(1, elapsed / estimatedSec);
  const meta = TASK_TYPE_META[task.type];

  const start = () => {
    vibrate(10);
    useHalo.getState().setTaskStatus(task.id, "in_progress");
    toast(t("mission.startedToast", { time: formatLocalTime(new Date(), property.timezone, locale) }));
  };

  const finish = () => {
    if (missingPhotos.length > 0) return;
    if (unchecked > 0 && !confirmUnchecked) {
      setConfirmUnchecked(true);
      return;
    }
    vibrate(20);
    const alerts = useHalo.getState().finishTask(task.id, me?.name);
    toast(t("agentToday.doneToast"), { description: alerts > 0 ? t("mission.alertsSent", { count: alerts }) : undefined });
    router.push("/a/today");
  };

  return (
    <div className="space-y-4 pb-28">
      <BackLink />

      {/* En-tête */}
      <header>
        <div className="flex items-center justify-between gap-3">
          <span className={cn("flex items-center gap-2 text-[15px] font-semibold", meta.text)}>
            <TaskTypeIcon type={task.type} size="sm" />
            {t(`taskType.${task.type}`)}
          </span>
          <div className="flex items-center gap-2">
            {task.priority !== "normal" && <Badge tone="danger">{t(`priority.${task.priority}`)}</Badge>}
            <StatusPill status={task.status} />
          </div>
        </div>
        <h1 className="mt-3 text-title-1">{property.name}</h1>
        <p className="mt-0.5 text-[15px] text-muted">{[property.addressLine, property.area, property.city].filter(Boolean).join(" · ")}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="text-[17px] font-semibold tabular">{deadline(task, property, new Date())}</span>
          <GuestBadges guests={task.guestsCount} babies={task.babies} pets={task.pets} vip={task.vip} />
        </div>
      </header>

      {task.status === "to_redo" && task.notes && <p className="rounded-lg bg-danger-soft px-4 py-3 text-[15px] text-danger">{task.notes}</p>}
      {task.vip && task.type === "turnover" && (
        <p className="rounded-lg bg-vip-soft px-4 py-3 text-[15px] font-medium text-vip">{t("mission.vipPrep")}</p>
      )}

      {/* Pointage */}
      <Card className="p-5">
        {finished ? (
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-full bg-success-soft text-success">
              <Check className="size-5" />
            </span>
            <div>
              <p className="text-[17px] font-semibold">{t("mission.finishedAt", { time: task.completedAt ? formatLocalTime(new Date(task.completedAt), property.timezone, locale) : "—" })}</p>
              <DurationCompare task={task} className="mt-0.5" />
            </div>
          </div>
        ) : started ? (
          <>
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="flex items-center gap-1.5 text-caption text-muted">
                  <span className="size-2 animate-pulse rounded-full bg-accent" aria-hidden />
                  {t("mission.inProgressSince", { time: task.startedAt ? formatLocalTime(new Date(task.startedAt), property.timezone, locale) : "" })}
                </p>
                <p className="mt-1 text-[40px] font-bold leading-none tracking-tight tabular" role="timer" aria-live="off">
                  {clock(elapsed)}
                </p>
              </div>
              <p className="text-end text-caption text-muted">
                {t("mission.estimated")}
                <span className="block text-[15px] font-semibold text-fg tabular">{formatDuration(task.durationMin, locale)}</span>
              </p>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-subtle dark:bg-surface-hover">
              <div className={cn("h-full rounded-full transition-[width]", progress >= 1 ? "bg-warning" : "bg-accent")} style={{ width: `${progress * 100}%` }} />
            </div>
          </>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-caption text-muted">
                <Timer className="size-3.5" />
                {t("mission.estimated")}
              </p>
              <p className="mt-0.5 text-title-2 tabular">{formatDuration(task.durationMin, locale)}</p>
            </div>
            <p className="max-w-[55%] text-end text-caption text-muted">{t("mission.clockHint")}</p>
          </div>
        )}
        {canStart && (
          <Button size="xl" className="mt-4 w-full" onClick={start}>
            <Play />
            {task.status === "to_redo" ? t("task.resume") : t("mission.start")}
          </Button>
        )}
      </Card>

      {/* Accès + itinéraire */}
      <div className="flex gap-2">
        {started && property.access.type !== "in_person" ? (
          <Card className="flex flex-1 items-center gap-3 px-4 py-3">
            <KeyRound className="size-5 shrink-0 text-muted" strokeWidth={1.9} />
            <div className="min-w-0">
              <div className="text-caption text-muted">{t(`access.${property.access.type}`)}</div>
              {property.access.code && <div className="text-[24px] font-bold tracking-[0.2em] tabular">{property.access.code}</div>}
              {property.access.instructions && <div className="text-[14px]">{property.access.instructions}</div>}
            </div>
          </Card>
        ) : null}
        <Button asChild size="xl" variant="secondary" className={cn("h-auto min-h-14 bg-surface px-4 shadow-card hover:bg-surface-hover", started && property.access.type !== "in_person" ? "w-auto shrink-0" : "w-auto flex-1")}>
          <a href={directionsUrl(property)} target="_blank" rel="noreferrer">
            <Navigation />
            {t("task.directions")}
          </a>
        </Button>
      </div>

      {property.instructions && <p className="rounded-lg bg-surface p-4 text-[15px] shadow-card">{property.instructions}</p>}

      <TaskLinenKit task={task} property={property} className="bg-surface shadow-card dark:bg-surface" />

      {/* Checklist par pièce */}
      {property.checklist.length > 0 && (
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-title-3">{t("mission.checklist")}</h2>
            <span className="text-[14px] font-semibold text-muted tabular">
              {checkedCount}/{items.length}
            </span>
          </div>
          {!started && !finished && <p className="mb-3 text-[14px] text-muted">{t("mission.startToCheck")}</p>}
          <div className="space-y-3">
            {property.checklist.map((room) => (
              <RoomCard key={room.id} room={room} task={task} editable={started} />
            ))}
          </div>
        </section>
      )}

      {started && (
        <Button variant="ghost" className="w-full text-danger" onClick={() => setReporting(true)}>
          <Siren />
          {t("alerts.report")}
        </Button>
      )}

      {/* Barre de fin de mission */}
      {started && (
        <div className="fixed inset-x-0 bottom-[calc(68px+env(safe-area-inset-bottom))] z-20 border-t border-line bg-canvas/90 px-4 py-3 backdrop-blur-xl">
          <div className="mx-auto max-w-xl">
            {missingPhotos.length > 0 ? (
              <p className="mb-2 flex items-center gap-1.5 text-[14px] font-medium text-danger">
                <Camera className="size-4 shrink-0" />
                {t("mission.photosMissing", { count: missingPhotos.length })}
              </p>
            ) : confirmUnchecked ? (
              <p className="mb-2 text-[14px] font-medium text-warning">{t("mission.uncheckedWarning", { count: unchecked })}</p>
            ) : null}
            <Button size="xl" className="w-full bg-success hover:bg-success hover:opacity-90" onClick={finish} disabled={missingPhotos.length > 0}>
              <Check />
              {confirmUnchecked ? t("mission.finishAnyway") : t("mission.finish", { time: clock(elapsed) })}
            </Button>
          </div>
        </div>
      )}

      <ReportSheet
        open={reporting}
        onOpenChange={setReporting}
        property={property}
        source="agent"
        taskId={task.id}
        reservationId={task.reservationId}
        reporterName={me?.name}
      />
    </div>
  );
}

function BackLink() {
  const t = useTranslations();
  return (
    <Link href="/a/today" className="-ms-1 inline-flex h-10 items-center gap-1 text-[15px] font-medium text-accent-text">
      <ArrowLeft className="size-4 rtl:-scale-x-100" />
      {t("nav.today")}
    </Link>
  );
}

/** Une pièce : points à cocher, photos, état constaté et commentaire. */
function RoomCard({ room, task, editable }: { room: ChecklistRoom; task: Task; editable: boolean }) {
  const t = useTranslations();
  const report = task.report;
  const state = report?.rooms[room.id] ?? {};
  const done = room.items.filter((i) => report?.checked.includes(i.id)).length;
  const complete = room.items.length > 0 && done === room.items.length;
  // Toutes les pièces ouvertes pendant la mission, repliables à la main
  const [openState, setOpen] = useState<boolean | null>(null);
  const open = openState ?? editable;
  const [commenting, setCommenting] = useState(Boolean(state.comment));
  const update = useHalo.getState().updateTaskReport;
  const readOnly = !editable;

  const toggleItem = (id: string) =>
    update(task.id, (r) => ({ ...r, checked: r.checked.includes(id) ? r.checked.filter((x) => x !== id) : [...r.checked, id] }));
  const addItemPhoto = (itemId: string, photoId: string) =>
    update(task.id, (r) => ({
      ...r,
      photos: { ...r.photos, [itemId]: [...(r.photos[itemId] ?? []), photoId] },
      // Une photo prise vaut point coché
      checked: r.checked.includes(itemId) ? r.checked : [...r.checked, itemId],
    }));
  const removeItemPhoto = (itemId: string, photoId: string) =>
    update(task.id, (r) => ({ ...r, photos: { ...r.photos, [itemId]: (r.photos[itemId] ?? []).filter((x) => x !== photoId) } }));
  const setRoom = (patch: { status?: RoomStatus; comment?: string; photoIds?: string[] }) =>
    update(task.id, (r) => ({ ...r, rooms: { ...r.rooms, [room.id]: { ...r.rooms[room.id], ...patch } } }));

  const statusMeta = state.status ? ROOM_STATUS_META[state.status] : null;
  const StatusIcon = statusMeta?.icon;

  return (
    <Card className="overflow-hidden" data-room={room.id}>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3.5 text-start">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-full border-2 text-[12px] font-bold tabular",
            complete ? "border-success bg-success text-white" : "border-line-strong text-muted",
          )}
        >
          {complete ? <Check className="size-4" /> : done}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-semibold">{room.name}</span>
          <span className="block text-caption text-muted tabular">
            {done}/{room.items.length}
            {statusMeta && StatusIcon && (
              <span className={cn("ms-2 inline-flex items-center gap-1 font-semibold", statusMeta.text)}>
                <StatusIcon className="size-3.5" />
                {t(`roomStatus.${state.status}`)}
              </span>
            )}
          </span>
        </span>
        <ChevronDown className={cn("size-5 text-muted transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="border-t border-line">
          <ul className="divide-y divide-line">
            {room.items.map((item) => {
              const checked = report?.checked.includes(item.id) ?? false;
              const photos = report?.photos[item.id] ?? [];
              return (
                <li key={item.id} className="px-4 py-3">
                  <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => {
                      vibrate(5);
                      toggleItem(item.id);
                    }}
                    className="flex w-full items-center gap-3 text-start disabled:cursor-default"
                    role="checkbox"
                    aria-checked={checked}
                  >
                    <span
                      className={cn(
                        "grid size-7 shrink-0 place-items-center rounded-full border-2 transition-colors",
                        checked ? "border-success bg-success text-white" : "border-line-strong",
                      )}
                    >
                      {checked && <Check className="size-4" strokeWidth={3} />}
                    </span>
                    <span className={cn("flex-1 text-[16px]", checked && "text-muted line-through decoration-1")}>{item.label}</span>
                    {item.photoRequired && (
                      <Camera className={cn("size-5 shrink-0", photos.length ? "text-success" : "text-danger")} aria-label={t("checklist.photoOn")} />
                    )}
                  </button>
                  {(item.photoRequired || photos.length > 0 || (item.referencePhotoIds?.length ?? 0) > 0) && (
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 ps-10">
                      {item.referencePhotoIds?.map((id) => (
                        <span key={id} className="relative">
                          <PhotoThumb id={id} size="sm" label={t("checklist.addReference")} />
                          <span className="absolute inset-x-0 bottom-0 bg-black/55 text-center text-[9px] font-semibold uppercase text-white">{t("mission.ref")}</span>
                        </span>
                      ))}
                      {photos.map((id) => (
                        <PhotoThumb key={id} id={id} size="sm" onRemove={readOnly ? undefined : () => removeItemPhoto(item.id, id)} />
                      ))}
                      {!readOnly && item.photoRequired && <AddPhotoButton compact className="size-12" onAdded={(pid) => addItemPhoto(item.id, pid)} />}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* État de la pièce */}
          <div className="border-t border-line bg-subtle/60 px-4 py-3 dark:bg-surface-hover/40">
            <p className="mb-2 text-micro text-muted">{t("mission.roomState")}</p>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("mission.roomState")}>
              {ROOM_STATUSES.map((st) => {
                const m = ROOM_STATUS_META[st];
                const Icon = m.icon;
                const on = state.status === st;
                return (
                  <button
                    key={st}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={readOnly}
                    onClick={() => {
                      setRoom({ status: on ? undefined : st });
                      if (!on && st !== "ok") setCommenting(true);
                    }}
                    className={cn(
                      "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:opacity-60",
                      on ? m.on : "border-line bg-surface text-fg hover:bg-surface-hover",
                    )}
                  >
                    <Icon className="size-4" />
                    {t(`roomStatus.${st}`)}
                  </button>
                );
              })}
            </div>
            {(commenting || state.comment) && (
              <div className="mt-3 space-y-2">
                <Textarea
                  aria-label={t("mission.comment")}
                  placeholder={t("mission.commentPlaceholder")}
                  defaultValue={state.comment ?? ""}
                  readOnly={readOnly}
                  onBlur={(e) => setRoom({ comment: e.target.value.trim() || undefined })}
                  className="min-h-20 bg-surface"
                />
                {!readOnly && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(state.photoIds ?? []).map((id) => (
                      <PhotoThumb key={id} id={id} size="sm" onRemove={() => setRoom({ photoIds: (state.photoIds ?? []).filter((x) => x !== id) })} />
                    ))}
                    <AddPhotoButton compact className="size-12" onAdded={(pid) => setRoom({ photoIds: [...(state.photoIds ?? []), pid] })} />
                  </div>
                )}
                {state.status && state.status !== "ok" && !readOnly && <p className="text-caption text-muted">{t("mission.issueHint")}</p>}
              </div>
            )}
            {!commenting && !state.comment && !readOnly && (
              <button type="button" onClick={() => setCommenting(true)} className="mt-2 text-[14px] font-medium text-accent-text">
                + {t("mission.addComment")}
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
