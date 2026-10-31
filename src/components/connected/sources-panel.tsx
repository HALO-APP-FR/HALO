"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { CalendarSync, Pause, Play, RefreshCw, Trash2 } from "lucide-react";
import { addIcalSource, deleteSource, resolveSourceConflict, setSourcePaused, syncIcalSource } from "@/lib/connected/source-actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";

export interface SourceRow {
  id: string;
  label: string | null;
  platform: string;
  url_hint: string | null;
  status: "active" | "paused";
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_counts: { created?: number; updated?: number; unchanged?: number; conflicts?: number; missing?: number; events?: number };
}
export interface SourceConflict {
  source_id: string;
  uid: string;
  conflict: string;
  feed_start: string;
  feed_end: string;
  reservation_id: string | null;
  stay_label: string | null;
}

/** Calendriers iCal du logement : dates seulement, à la demande, HALO prioritaire, conflits arbitrés. */
export function SourcesPanel({ propertyId, sources, conflicts, timeZone }: { propertyId: string; sources: SourceRow[]; conflicts: SourceConflict[]; timeZone: string }) {
  const t = useTranslations("connected.sources");
  const f = useFormatter();
  const { pending, error, run } = useRun();
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [platform, setPlatform] = useState<"airbnb" | "booking" | "vrbo" | "other">("airbnb");
  const [msg, setMsg] = useState<string | null>(null);
  const d = (x: string) => f.dateTime(new Date(x), { dateStyle: "medium", timeStyle: "short", timeZone });
  return (
    <Card className="space-y-4 p-5" data-testid="sources-panel">
      <div>
        <h2 className="flex items-center gap-2 text-[17px] font-semibold">
          <CalendarSync className="size-5" />
          {t("title")}
        </h2>
        <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
        <p className="mt-1 text-[13px] text-muted">{t("rule")}</p>
      </div>
      {sources.length === 0 && <p className="text-[14px] text-muted">{t("none")}</p>}
      <ul className="space-y-3">
        {sources.map((s) => (
          <li key={s.id} className="rounded-md border border-line p-3" data-testid="source-row" data-status={s.status}>
            <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
              <span className="flex-1">
                {s.label || t(`platform.${s.platform}`)} <span className="text-[12px] font-normal text-muted">· {s.url_hint}</span>
              </span>
              {s.status === "paused" && <span className="rounded-full bg-subtle px-2 py-0.5 text-[12px] text-muted dark:bg-surface-hover">{t("paused")}</span>}
            </p>
            <p className="mt-1 text-[13px] text-muted" data-testid="source-state">
              {t("facts")} · {s.last_success_at ? t("lastSuccess", { date: d(s.last_success_at) }) : t("neverSynced")}
              {s.last_success_at && s.last_counts.events !== undefined ? ` · ${t("counts", { created: s.last_counts.created ?? 0, updated: s.last_counts.updated ?? 0, conflicts: (s.last_counts.conflicts ?? 0) + (s.last_counts.missing ?? 0) })}` : ""}
            </p>
            {s.last_error && s.last_sync_at && (!s.last_success_at || s.last_sync_at > s.last_success_at) && (
              <p className="mt-1 text-[13px] text-danger" data-testid="source-error">
                {t("lastError", { date: d(s.last_sync_at), error: t(`error.${["unreachable", "timeout", "not_ical", "too_large", "not_https", "forbidden_host", "invalid"].includes(s.last_error) ? s.last_error : "unreachable"}`) })}
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={pending || s.status === "paused"} onClick={() => run(() => syncIcalSource(s.id), (r) => setMsg(t("synced", { created: r.created, updated: r.updated, conflicts: r.conflicts + r.missing })))} data-testid="source-sync">
                <RefreshCw />
                {t("syncNow")}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => setSourcePaused(s.id, s.status === "active"))} data-testid="source-pause">
                {s.status === "active" ? <Pause /> : <Play />}
                {s.status === "active" ? t("pause") : t("resume")}
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => deleteSource(s.id))} data-testid="source-delete">
                <Trash2 />
                {t("disconnect")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {msg && <p role="status" className="text-[14px] text-success" data-testid="source-synced">{msg}</p>}
      {conflicts.length > 0 && (
        <div className="space-y-2" data-testid="source-conflicts">
          <h3 className="text-[15px] font-semibold text-warning">{t("conflictsTitle", { count: conflicts.length })}</h3>
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <li key={c.source_id + c.uid} className="rounded-md border border-warning p-3 text-[14px]" data-testid="source-conflict" data-conflict={c.conflict}>
                <p className="font-medium">{t(`conflict.${c.conflict}`)}</p>
                <p className="text-muted">
                  {c.stay_label ? `${c.stay_label} · ` : ""}
                  {t("feedDates", { from: d(c.feed_start), to: d(c.feed_end) })}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveSourceConflict(c.source_id, c.uid, "keep_halo"))} data-testid="conflict-keep">
                    {t("keepHalo")}
                  </Button>
                  {(c.conflict === "modified_in_halo" || c.conflict === "dates_changed") && c.reservation_id && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resolveSourceConflict(c.source_id, c.uid, "apply_feed"))} data-testid="conflict-apply">
                      {t("applyFeed")}
                    </Button>
                  )}
                  {c.conflict === "missing_from_feed" && c.reservation_id && (
                    <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => resolveSourceConflict(c.source_id, c.uid, "cancel_stay"))} data-testid="conflict-cancel">
                      {t("cancelStay")}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
      <form
        className="grid gap-3 border-t border-line pt-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => addIcalSource(propertyId, url, label, platform), () => (setUrl(""), setLabel("")));
        }}
      >
        <Field label={t("url")} htmlFor="src-url" hint={t("urlHint")} className="sm:col-span-2">
          <Input id="src-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…/calendar.ics" autoComplete="off" data-testid="source-url" />
        </Field>
        <Field label={t("platformLabel")} htmlFor="src-pf">
          <Select id="src-pf" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)}>
            {(["airbnb", "booking", "vrbo", "other"] as const).map((p) => (
              <option key={p} value={p}>
                {t(`platform.${p}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("label")} htmlFor="src-label">
          <Input id="src-label" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          <Button type="submit" size="sm" className="ms-auto" disabled={pending || !url.trim()} data-testid="source-add">
            {t("add")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
