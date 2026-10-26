"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowRight, CheckCircle2, Hammer, MapPin, Plus, RotateCcw, Siren, User, Wrench } from "lucide-react";
import type { Alert, AlertStatus } from "@/lib/domain/types";
import { addDaysToKey, localDateKey, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { byId } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { EmptyState } from "@/components/halo/empty-state";
import { PageHeader } from "@/components/halo/page-header";
import { PhotoThumb } from "@/components/halo/photo-thumb";
import { ReadyGate } from "@/components/halo/ready-gate";
import { ReportSheet } from "@/components/halo/report-sheet";
import { cn } from "@/lib/utils";

type Filter = "active" | AlertStatus | "all";

export function useRelativeTime() {
  const locale = useLocale();
  return (iso: string) => {
    const diff = (new Date(iso).getTime() - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    const abs = Math.abs(diff);
    if (abs < 3600) return rtf.format(Math.round(diff / 60), "minute");
    if (abs < 86400) return rtf.format(Math.round(diff / 3600), "hour");
    return rtf.format(Math.round(diff / 86400), "day");
  };
}

export const ALERT_STATUS_TONE: Record<AlertStatus, "danger" | "warning" | "success"> = {
  open: "danger",
  in_progress: "warning",
  resolved: "success",
};

export function Alerts() {
  return (
    <ReadyGate>
      <AlertsInner />
    </ReadyGate>
  );
}

function AlertsInner() {
  const t = useTranslations();
  const alerts = useHalo((s) => s.alerts);
  const properties = useHalo((s) => s.properties);
  const props = byId(properties);
  const ago = useRelativeTime();
  const [filter, setFilter] = useState<Filter>("active");
  const [source, setSource] = useState<"all" | Alert["source"]>("all");
  const [propertyId, setPropertyId] = useState("all");
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newFor, setNewFor] = useState("");

  const list = alerts
    .filter((a) => (filter === "all" ? true : filter === "active" ? a.status !== "resolved" : a.status === filter))
    .filter((a) => source === "all" || a.source === source)
    .filter((a) => propertyId === "all" || a.propertyId === propertyId)
    .sort((a, b) => Number(b.urgent && b.status !== "resolved") - Number(a.urgent && a.status !== "resolved") || b.createdAt.localeCompare(a.createdAt));
  const activeCount = alerts.filter((a) => a.status !== "resolved").length;
  const newProperty = properties.find((p) => p.id === newFor);

  return (
    <>
      <PageHeader
        title={t("nav.alerts")}
        subtitle={t("alerts.count", { count: activeCount })}
        actions={
          <Button onClick={() => setCreating(true)} disabled={properties.length === 0}>
            <Plus />
            {t("alerts.new")}
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label={t("alerts.filter")}
          value={filter}
          onChange={setFilter}
          className="flex w-full md:inline-flex md:w-auto"
          options={[
            { value: "active", label: t("alerts.active") },
            { value: "resolved", label: t("alertStatus.resolved") },
            { value: "all", label: t("alerts.all") },
          ]}
        />
        <div className="grid w-full grid-cols-2 gap-2 md:ms-auto md:w-auto">
          <Select aria-label={t("alerts.source")} value={source} onChange={(e) => setSource(e.target.value as typeof source)}>
            <option value="all">{t("alerts.allSources")}</option>
            <option value="agent">{t("alertSource.agent")}</option>
            <option value="guest">{t("alertSource.guest")}</option>
            <option value="manager">{t("alertSource.manager")}</option>
          </Select>
          <Select aria-label={t("tasks.property")} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
            <option value="all">{t("tasks.allProperties")}</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {list.length === 0 ? (
        <Card>
          <EmptyState icon={CheckCircle2} title={t("alerts.empty")} text={t("alerts.emptyText")} />
        </Card>
      ) : (
        <ul className="space-y-3">
          {list.map((a) => {
            const p = props.get(a.propertyId);
            return (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpen(a.id)}
                  className={cn(
                    "relative flex w-full gap-4 overflow-hidden rounded-xl border bg-surface p-4 text-start shadow-card transition-colors hover:bg-surface-hover md:p-5",
                    a.urgent && a.status !== "resolved" ? "border-danger/50" : "border-line",
                  )}
                >
                  {a.urgent && a.status !== "resolved" && <span className="absolute inset-y-0 start-0 w-1 bg-danger" aria-hidden />}
                  <span
                    className={cn(
                      "grid size-10 shrink-0 place-items-center rounded-lg",
                      a.status === "resolved" ? "bg-success-soft text-success" : a.urgent ? "bg-danger-soft text-danger" : "bg-warning-soft text-warning",
                    )}
                  >
                    {a.status === "resolved" ? <CheckCircle2 className="size-5" /> : <Siren className="size-5" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[16px] font-semibold">{t(`alertCategory.${a.category}`)}</span>
                      {a.location && <span className="text-[15px] text-muted">· {a.location.label}</span>}
                      {a.urgent && a.status !== "resolved" && <Badge tone="danger">{t("alerts.urgentBadge")}</Badge>}
                    </span>
                    <span className="mt-0.5 block text-[14px] font-medium">{p?.name}</span>
                    {a.description && <span className="mt-1 line-clamp-2 block text-[14px] text-muted">{a.description}</span>}
                    <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
                      <Badge tone={ALERT_STATUS_TONE[a.status]}>{t(`alertStatus.${a.status}`)}</Badge>
                      <span className="flex items-center gap-1">
                        <User className="size-3.5" />
                        {t(`alertSource.${a.source}`)}
                        {a.reporterName ? ` · ${a.reporterName}` : ""}
                      </span>
                      <span>{ago(a.createdAt)}</span>
                    </span>
                  </span>
                  {a.photoIds.length > 0 && (
                    <span className="hidden shrink-0 sm:block">
                      <PhotoThumb id={a.photoIds[0]} size="md" />
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <AlertSheet alertId={open} onClose={() => setOpen(null)} />

      {/* Nouvelle alerte (manager) : choisir le logement, puis le formulaire de signalement */}
      <Sheet open={creating && !newProperty} onOpenChange={(o) => !o && setCreating(false)}>
        <SheetContent title={t("alerts.new")} description={t("alerts.newHint")} closeLabel={t("common.close")}>
          <ul className="divide-y divide-line rounded-lg border border-line">
            {properties
              .filter((p) => !p.archived)
              .map((p) => (
                <li key={p.id}>
                  <button type="button" onClick={() => setNewFor(p.id)} className="flex min-h-12 w-full items-center justify-between px-4 text-start text-[15px] font-medium hover:bg-surface-hover">
                    {p.name}
                    <ArrowRight className="size-4 text-faint rtl:-scale-x-100" />
                  </button>
                </li>
              ))}
          </ul>
        </SheetContent>
      </Sheet>
      {newProperty && (
        <ReportSheet
          open
          onOpenChange={(o) => {
            if (!o) {
              setNewFor("");
              setCreating(false);
            }
          }}
          property={newProperty}
          source="manager"
        />
      )}
    </>
  );
}

export function AlertSheet({ alertId, onClose }: { alertId: string | null; onClose: () => void }) {
  if (!alertId) return null;
  return <AlertSheetInner key={alertId} alertId={alertId} onClose={onClose} />;
}

function AlertSheetInner({ alertId, onClose }: { alertId: string; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const alert = useHalo((s) => s.alerts.find((a) => a.id === alertId));
  const property = useHalo((s) => s.properties.find((p) => p.id === alert?.propertyId));
  const followUp = useHalo((s) => s.tasks.find((x) => x.id === alert?.followUpTaskId));
  const ago = useRelativeTime();
  const [resolution, setResolution] = useState("");
  const [resolving, setResolving] = useState(false);
  const [planning, setPlanning] = useState(false);
  const tz = property?.timezone ?? "UTC";
  const [day, setDay] = useState(() => addDaysToKey(localDateKey(new Date(), tz), alert?.urgent ? 0 : 1));
  const [from, setFrom] = useState(alert?.urgent ? "14:00" : "09:00");
  const [to, setTo] = useState(alert?.urgent ? "18:00" : "12:00");
  if (!alert || !property) return null;
  const { updateAlert, createFollowUp } = useHalo.getState();

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={t(`alertCategory.${alert.category}`)} description={property.name} closeLabel={t("common.close")}>
        <div className="space-y-5 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={ALERT_STATUS_TONE[alert.status]}>{t(`alertStatus.${alert.status}`)}</Badge>
            {alert.urgent && <Badge tone="danger">{t("alerts.urgentBadge")}</Badge>}
            <span className="text-caption text-muted">
              {t(`alertSource.${alert.source}`)}
              {alert.reporterName ? ` · ${alert.reporterName}` : ""} · {ago(alert.createdAt)}
            </span>
          </div>
          {alert.location && (
            <p className="flex items-center gap-2 text-[15px] font-medium">
              <MapPin className="size-4 text-muted" />
              {alert.location.label}
            </p>
          )}
          {alert.description && <p className="whitespace-pre-line rounded-lg bg-subtle p-4 text-[15px] dark:bg-surface-hover">{alert.description}</p>}
          {alert.photoIds.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {alert.photoIds.map((p) => (
                <PhotoThumb key={p} id={p} size="lg" />
              ))}
            </div>
          )}
          {alert.resolution && (
            <p className="rounded-lg bg-success-soft p-3 text-[14px]">
              <strong>{t("alerts.resolution")} :</strong> {alert.resolution}
            </p>
          )}

          {followUp ? (
            <div className="flex items-center gap-2 rounded-lg border border-line p-3 text-[14px]">
              <Wrench className="size-4 text-muted" />
              {t("alerts.followUpPlanned", {
                date: new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(followUp.windowStart)),
              })}
            </div>
          ) : (
            alert.status !== "resolved" &&
            (planning ? (
              <form
                className="space-y-3 rounded-lg border border-line p-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  const start = zonedTimeToUtc(day, from, tz);
                  const end = zonedTimeToUtc(day, to, tz);
                  if (!(end > start)) return;
                  createFollowUp(alert.id, start.toISOString(), end.toISOString());
                  toast(t("alerts.followUpCreated"));
                  setPlanning(false);
                }}
              >
                <Field label={t("tasks.date")} htmlFor="f-day">
                  <Input id="f-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t("tasks.from")} htmlFor="f-from">
                    <Input id="f-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
                  </Field>
                  <Field label={t("tasks.to")} htmlFor="f-to">
                    <Input id="f-to" type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
                  </Field>
                </div>
                <Button type="submit" className="w-full">
                  {t("alerts.planFollowUp")}
                </Button>
              </form>
            ) : (
              <Button variant="secondary" size="lg" className="w-full" onClick={() => setPlanning(true)}>
                <Hammer />
                {t("alerts.createFollowUp")}
              </Button>
            ))
          )}

          {alert.status === "open" && (
            <Button size="lg" className="w-full" onClick={() => updateAlert(alert.id, { status: "in_progress" })}>
              {t("alerts.takeCharge")}
            </Button>
          )}
          {alert.status !== "resolved" &&
            (resolving ? (
              <form
                className="space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  updateAlert(alert.id, { status: "resolved", resolution: resolution.trim() || undefined });
                  toast(t("alerts.resolvedToast"));
                  onClose();
                }}
              >
                <Field label={t("alerts.resolution")} htmlFor="res" hint={t("alerts.resolutionHint")}>
                  <Textarea id="res" value={resolution} onChange={(e) => setResolution(e.target.value)} autoFocus />
                </Field>
                <Button type="submit" size="lg" className="w-full bg-success hover:bg-success hover:opacity-90">
                  <CheckCircle2 />
                  {t("alerts.markResolved")}
                </Button>
              </form>
            ) : (
              <Button variant="outline" size="lg" className="w-full" onClick={() => setResolving(true)}>
                <CheckCircle2 />
                {t("alerts.resolve")}
              </Button>
            ))}
          {alert.status === "resolved" && (
            <Button variant="ghost" className="w-full" onClick={() => updateAlert(alert.id, { status: "open" })}>
              <RotateCcw />
              {t("alerts.reopen")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
