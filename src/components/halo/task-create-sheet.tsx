"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { TaskType } from "@/lib/domain/types";
import { localDateKey, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { activeAgents } from "@/lib/store/selectors";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";

const TYPES: TaskType[] = ["turnover", "check_in", "check_out", "linen_delivery", "linen_pickup", "inspection", "other"];

export function TaskCreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const allProperties = useHalo((s) => s.properties);
  const properties = allProperties.filter((p) => !p.archived);
  const members = useHalo((s) => s.members);
  const agents = activeAgents(members);
  const [propertyId, setPropertyId] = useState("");
  const [type, setType] = useState<TaskType>("inspection");
  const property = properties.find((p) => p.id === propertyId) ?? properties[0];
  const tz = property?.timezone ?? "UTC";
  const [date, setDate] = useState(() => localDateKey(new Date(), tz));
  const [from, setFrom] = useState("10:00");
  const [to, setTo] = useState("12:00");
  const [duration, setDuration] = useState(60);
  const [agentId, setAgentId] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!property) return null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const start = zonedTimeToUtc(date, from, tz);
    const end = zonedTimeToUtc(date, to, tz);
    if (!(end > start)) {
      setError(t("tasks.errorWindow"));
      return;
    }
    if (duration > (end.getTime() - start.getTime()) / 60_000) {
      setError(t("tasks.errorDuration"));
      return;
    }
    useHalo.getState().addTask({
      propertyId: property.id,
      type,
      windowStart: start.toISOString(),
      windowEnd: end.toISOString(),
      durationMin: duration,
      assigneeId: agentId || undefined,
      scheduledStart: agentId ? start.toISOString() : undefined,
      notes: notes.trim() || undefined,
    });
    toast(t("tasks.created"));
    setError(null);
    setNotes("");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t("tasks.new")} description={t("tasks.newHint")} closeLabel={t("common.close")}>
        <form onSubmit={submit} noValidate className="space-y-4 pt-2">
          <Field label={t("tasks.property")} htmlFor="n-prop">
            <Select id="n-prop" value={property.id} onChange={(e) => setPropertyId(e.target.value)}>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tasks.type")} htmlFor="n-type">
            <Select id="n-type" value={type} onChange={(e) => setType(e.target.value as TaskType)}>
              {TYPES.map((x) => (
                <option key={x} value={x}>
                  {t(`taskType.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tasks.date")} htmlFor="n-date">
            <Input id="n-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("tasks.from")} htmlFor="n-from">
              <Input id="n-from" type="time" step={900} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label={t("tasks.to")} htmlFor="n-to">
              <Input id="n-to" type="time" step={900} value={to} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <Field label={t("tasks.duration")} htmlFor="n-dur">
            <Select id="n-dur" value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
              {Array.from({ length: 16 }, (_, i) => (i + 1) * 15).map((m) => (
                <option key={m} value={m}>
                  {t("time.duration", { hours: Math.floor(m / 60), minutes: m % 60 })}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tasks.agent")} htmlFor="n-agent">
            <Select id="n-agent" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">{t("tasks.noAgentYet")}</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("tasks.notes")} htmlFor="n-notes">
            <Textarea id="n-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-[14px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="xl">
            {t("tasks.create")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
