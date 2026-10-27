"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, ChevronLeft, ChevronRight, Link2, Plus, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { Property, Reservation, ReservationSource } from "@/lib/domain/types";
import { parseIcs } from "@/lib/engine/ical";
import { PET_EXTRA_MIN } from "@/lib/engine/tasks";
import { addDaysToKey, formatLocalTime, localDateKey, localMinutesOfDay, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { taskDayKey } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { EmptyState } from "./empty-state";
import { GuestBadges } from "./guest-badges";
import { Stepper } from "./property-create-sheet";
import { cn } from "@/lib/utils";

const SOURCES: ReservationSource[] = ["airbnb", "booking", "vrbo", "other"];

/** Synchronise un calendrier iCal : téléchargement (serveur) puis lecture (navigateur). */
export async function syncFeed(property: Property, feedId: string) {
  const feed = property.feeds.find((f) => f.id === feedId);
  const { importFeed } = useHalo.getState();
  if (!feed) return { ok: false as const, error: "invalid" };
  try {
    const res = await fetch("/api/ical", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: feed.url }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      const error = body.error ?? "unreachable";
      importFeed(property.id, feedId, null, error);
      return { ok: false as const, error };
    }
    const events = parseIcs(await res.text(), property);
    return { ok: true as const, ...importFeed(property.id, feedId, events) };
  } catch {
    importFeed(property.id, feedId, null, "unreachable");
    return { ok: false as const, error: "unreachable" };
  }
}

export function PropertyCalendar({ property }: { property: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  const reservations = useHalo((s) => s.reservations);
  const tasks = useHalo((s) => s.tasks);
  const tz = property.timezone;
  const todayKey = localDateKey(new Date(), tz);
  const [month, setMonth] = useState(todayKey.slice(0, 7)); // AAAA-MM
  const [stayOpen, setStayOpen] = useState(false);
  const [editingStay, setEditingStay] = useState<Reservation | undefined>(undefined);

  const mine = reservations.filter((r) => r.propertyId === property.id && r.status !== "cancelled");
  const keyOf = (iso: string) => localDateKey(new Date(iso), tz);

  // Grille du mois (semaine commençant le lundi)
  const [y, m] = month.split("-").map(Number);
  const first = `${month}-01`;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const days = Array.from({ length: daysInMonth }, (_, i) => addDaysToKey(first, i));
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 0, 5 + i, 12))),
  );
  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${first}T12:00:00Z`));
  const shiftMonth = (delta: number) => {
    const d = new Date(Date.UTC(y, m - 1 + delta, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  const turnoverDays = new Set(
    tasks.filter((x) => x.propertyId === property.id && x.type === "turnover" && x.status !== "cancelled").map((x) => taskDayKey(x, property)),
  );

  const upcoming = mine
    .filter((r) => new Date(r.checkOutAt) > new Date())
    .sort((a, b) => new Date(a.checkInAt).getTime() - new Date(b.checkInAt).getTime());

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="first-letter:uppercase">{monthLabel}</CardTitle>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" onClick={() => shiftMonth(-1)} aria-label={t("common.previous")}>
                <ChevronLeft className="rtl:-scale-x-100" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => shiftMonth(1)} aria-label={t("common.next")}>
                <ChevronRight className="rtl:-scale-x-100" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-7 text-center text-micro text-muted" aria-hidden>
              {weekdays.map((d, i) => (
                <span key={i} className="pb-2">
                  {d}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {Array.from({ length: lead }, (_, i) => (
                <span key={`l${i}`} />
              ))}
              {days.map((d) => {
                const night = mine.find((r) => keyOf(r.checkInAt) <= d && d < keyOf(r.checkOutAt));
                const leaving = mine.find((r) => keyOf(r.checkOutAt) === d);
                const blocked = night?.status === "blocked";
                const arriving = night && keyOf(night.checkInAt) === d;
                const turnover = turnoverDays.has(d);
                return (
                  <div key={d} className="relative flex h-14 flex-col items-center pt-1.5">
                    <span
                      className={cn(
                        "relative z-10 grid size-7 place-items-center rounded-full text-[13px] tabular",
                        d === todayKey && "bg-fg font-semibold text-canvas",
                        d < todayKey && d !== todayKey && "text-faint",
                      )}
                    >
                      {Number(d.slice(8))}
                    </span>
                    {/* Bande d'occupation : nuit en cours / départ */}
                    {night && (
                      <span
                        className={cn(
                          "absolute bottom-3 h-2",
                          arriving ? "start-1/2 end-0 rounded-s-full" : "start-0 end-0",
                          blocked ? "bg-line-strong" : night.vip ? "bg-vip" : "bg-accent",
                        )}
                        aria-hidden
                      />
                    )}
                    {leaving && (
                      <span
                        className={cn("absolute bottom-3 start-0 end-1/2 h-2 rounded-e-full", leaving.status === "blocked" ? "bg-line-strong" : leaving.vip ? "bg-vip" : "bg-accent")}
                        aria-hidden
                      />
                    )}
                    {turnover && (
                      <span
                        className={cn("absolute start-1/2 top-0 z-20 ms-2 grid size-4 place-items-center rounded-full bg-type-turnover text-white ring-2 ring-surface", d < todayKey && "opacity-40")}
                        aria-hidden
                      >
                        <Sparkles className="size-2.5" strokeWidth={2.6} />
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-5 rounded-full bg-accent" aria-hidden /> {t("calendar.legendStay")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-5 rounded-full bg-line-strong" aria-hidden /> {t("calendar.legendBlocked")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-5 rounded-full bg-vip" aria-hidden /> {t("vip.legend")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="grid size-4 place-items-center rounded-full bg-type-turnover text-white" aria-hidden>
                  <Sparkles className="size-2.5" strokeWidth={2.6} />
                </span>
                {t("calendar.legendCleaning")}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("calendar.stays")}</CardTitle>
            <Button
              size="sm"
              onClick={() => {
                setEditingStay(undefined);
                setStayOpen(true);
              }}
            >
              <Plus />
              {t("calendar.addStay")}
            </Button>
          </CardHeader>
          <CardContent className="pt-2">
            {upcoming.length === 0 ? (
              <EmptyState icon={CalendarPlus} title={t("calendar.noStay")} text={t("calendar.noStayText")} className="py-8" />
            ) : (
              <ul className="divide-y divide-line">
                {upcoming.map((r) => (
                  <StayRow
                    key={r.id}
                    stay={r}
                    property={property}
                    onEdit={() => {
                      setEditingStay(r);
                      setStayOpen(true);
                    }}
                  />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <FeedsCard property={property} />
      <StaySheet property={property} stay={editingStay} open={stayOpen} onOpenChange={setStayOpen} />
    </div>
  );
}

function StayRow({ stay, property, onEdit }: { stay: Reservation; property: Property; onEdit: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const tz = property.timezone;
  const fmt = (iso: string) =>
    `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso))} · ${formatLocalTime(new Date(iso), tz, locale)}`;
  const nights = Math.max(
    1,
    Math.round(
      (new Date(`${localDateKey(new Date(stay.checkOutAt), tz)}T12:00:00Z`).getTime() -
        new Date(`${localDateKey(new Date(stay.checkInAt), tz)}T12:00:00Z`).getTime()) /
        86_400_000,
    ),
  );

  return (
    <li>
      <button type="button" onClick={onEdit} className="flex w-full items-center gap-3 py-3 text-start">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-semibold">
              {stay.status === "blocked" ? t("calendar.blocked") : stay.guestName ?? t(`source.${stay.source}`)}
            </span>
            {stay.source !== "manual" && <Badge>{t(`source.${stay.source}`)}</Badge>}
          </div>
          <div className="mt-0.5 text-caption text-muted tabular">
            {fmt(stay.checkInAt)} → {fmt(stay.checkOutAt)}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="text-caption text-muted">{t("calendar.nights", { count: nights })}</span>
            <GuestBadges guests={stay.guestsCount} babies={stay.babies} pets={stay.pets} vip={stay.vip} size="sm" />
          </div>
          {stay.notes && <p className="mt-1 line-clamp-2 text-caption text-fg">{stay.notes}</p>}
        </div>
        <ChevronRight className="size-4 shrink-0 text-faint rtl:-scale-x-100" />
      </button>
    </li>
  );
}

/** Ajout ou modification d'un séjour (les dates d'un séjour importé restent celles de la plateforme). */
function StaySheet({
  property,
  stay,
  open,
  onOpenChange,
}: {
  property: Property;
  stay?: Reservation;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  if (!open) return null;
  return <StaySheetInner key={stay?.id ?? "new"} property={property} stay={stay} onOpenChange={onOpenChange} />;
}

function StaySheetInner({ property, stay, onOpenChange }: { property: Property; stay?: Reservation; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const reservations = useHalo((s) => s.reservations);
  const tz = property.timezone;
  const todayKey = localDateKey(new Date(), tz);
  const editing = Boolean(stay);
  const imported = Boolean(stay?.feedId);
  const timeOf = (iso: string) => {
    const m = localMinutesOfDay(new Date(iso), tz);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const [guestName, setGuestName] = useState(stay?.guestName ?? "");
  const [adults, setAdults] = useState(stay?.adults ?? stay?.guestsCount ?? 2);
  const [children, setChildren] = useState(stay?.children ?? 0);
  const [babies, setBabies] = useState(stay?.babies ?? 0);
  const [pets, setPets] = useState(stay?.pets ?? 0);
  const [notes, setNotes] = useState(stay?.notes ?? "");
  const [vip, setVip] = useState(stay?.vip ?? false);
  const [inDate, setInDate] = useState(stay ? localDateKey(new Date(stay.checkInAt), tz) : todayKey);
  const [inTime, setInTime] = useState(stay ? timeOf(stay.checkInAt) : property.defaultCheckIn);
  const [outDate, setOutDate] = useState(stay ? localDateKey(new Date(stay.checkOutAt), tz) : addDaysToKey(todayKey, 2));
  const [outTime, setOutTime] = useState(stay ? timeOf(stay.checkOutAt) : property.defaultCheckOut);
  const [source, setSource] = useState<ReservationSource>(stay?.source ?? "manual");
  const [error, setError] = useState<string | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const checkIn = zonedTimeToUtc(inDate, inTime, tz);
    const checkOut = zonedTimeToUtc(outDate, outTime, tz);
    if (!imported) {
      if (!(checkOut > checkIn)) {
        setError(t("calendar.errorDates"));
        return;
      }
      const overlap = reservations.some(
        (r) =>
          r.id !== stay?.id &&
          r.propertyId === property.id &&
          r.status === "confirmed" &&
          new Date(r.checkInAt) < checkOut &&
          new Date(r.checkOutAt) > checkIn,
      );
      if (overlap) {
        setError(t("calendar.errorOverlap"));
        return;
      }
    }
    const details = {
      guestName: guestName.trim() || undefined,
      adults,
      children,
      babies,
      pets,
      guestsCount: adults + children,
      notes: notes.trim() || undefined,
      vip: vip || undefined,
    };
    const { addReservation, updateReservation } = useHalo.getState();
    if (stay) {
      updateReservation(stay.id, imported ? details : { ...details, source, checkInAt: checkIn.toISOString(), checkOutAt: checkOut.toISOString() });
      toast(t("form.saved"));
    } else {
      addReservation({ propertyId: property.id, source, checkInAt: checkIn.toISOString(), checkOutAt: checkOut.toISOString(), ...details });
      toast(t("calendar.stayAdded"));
    }
    onOpenChange(false);
  };

  const counter = (label: string, value: number, set: (v: number) => void, min = 0) => (
    <div className="flex items-center justify-between gap-3 px-4 py-2">
      <span className="text-[15px]">{label}</span>
      <Stepper label={label} value={value} onChange={set} min={min} max={30} />
    </div>
  );

  return (
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        title={editing ? stay?.guestName ?? t("calendar.editStay") : t("calendar.addStay")}
        description={imported ? t("calendar.importedHint") : t("calendar.addStayHint")}
        closeLabel={t("common.close")}
      >
        <form onSubmit={submit} noValidate className="space-y-4 pt-2">
          <Field label={t("calendar.guestName")} htmlFor="s-name" hint={t("calendar.guestNameHint")}>
            <Input id="s-name" value={guestName} onChange={(e) => setGuestName(e.target.value)} autoComplete="off" />
          </Field>
          <fieldset className="divide-y divide-line rounded-lg border border-line">
            <legend className="sr-only">{t("guests.composition")}</legend>
            {counter(t("guests.adults"), adults, setAdults, 1)}
            {counter(t("guests.children"), children, setChildren)}
            {counter(t("guests.babiesLabel"), babies, setBabies)}
            {counter(t("guests.petsLabel"), pets, setPets)}
          </fieldset>
          {(babies > 0 || pets > 0) && (
            <p className="text-caption text-muted">
              {[babies > 0 ? t("guests.babyImpact") : "", pets > 0 ? t("guests.petImpact", { minutes: PET_EXTRA_MIN }) : ""].filter(Boolean).join(" ")}
            </p>
          )}
          {!imported && (
            <>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label={t("calendar.arrival")} htmlFor="s-in">
                  <Input id="s-in" type="date" value={inDate} onChange={(e) => setInDate(e.target.value)} />
                </Field>
                <Field label={t("calendar.time")} htmlFor="s-in-t">
                  <Input id="s-in-t" type="time" step={900} value={inTime} onChange={(e) => setInTime(e.target.value)} />
                </Field>
              </div>
              <div className="grid grid-cols-[1fr_120px] gap-3">
                <Field label={t("calendar.departure")} htmlFor="s-out">
                  <Input id="s-out" type="date" value={outDate} min={inDate} onChange={(e) => setOutDate(e.target.value)} />
                </Field>
                <Field label={t("calendar.time")} htmlFor="s-out-t">
                  <Input id="s-out-t" type="time" step={900} value={outTime} onChange={(e) => setOutTime(e.target.value)} />
                </Field>
              </div>
              <Field label={t("calendar.source")} htmlFor="s-src">
                <Select id="s-src" value={source} onChange={(e) => setSource(e.target.value as ReservationSource)}>
                  {(["manual", ...SOURCES] as ReservationSource[]).map((x) => (
                    <option key={x} value={x}>
                      {t(`source.${x}`)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}
          <SwitchRow id="s-vip" label={t("vip.label")} description={t("vip.hint")} checked={vip} onCheckedChange={setVip} />
          <Field label={t("calendar.stayNotes")} htmlFor="s-notes" hint={t("calendar.stayNotesHint")}>
            <Textarea id="s-notes" value={notes} onChange={(e) => setNotes(e.target.value)} className="min-h-20" />
          </Field>
          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-[14px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="xl">
            {editing ? t("form.save") : t("calendar.addStay")}
          </Button>
          {editing && !imported && stay?.status !== "cancelled" &&
            (confirmCancel ? (
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="danger"
                  className="flex-1"
                  onClick={() => {
                    useHalo.getState().cancelReservation(stay!.id);
                    toast(t("calendar.stayCancelled"));
                    onOpenChange(false);
                  }}
                >
                  {t("calendar.confirmCancel")}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmCancel(false)}>
                  {t("calendar.keep")}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="w-full text-danger" onClick={() => setConfirmCancel(true)}>
                <Trash2 />
                {t("calendar.cancelStay")}
              </Button>
            ))}
        </form>
      </SheetContent>
    </Sheet>
  );
}

function FeedsCard({ property }: { property: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  const [url, setUrl] = useState("");
  const [source, setSource] = useState<ReservationSource>("airbnb");
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const report = (result: Awaited<ReturnType<typeof syncFeed>>) => {
    if (result.ok) toast(t("calendar.syncDone", { added: result.added, updated: result.updated, cancelled: result.cancelled }));
    else toast(t(`calendar.error_${result.error}` as "calendar.error_unreachable"));
  };

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^(https|webcal):\/\//i.test(url.trim())) {
      setFormError(t("calendar.error_not_https"));
      return;
    }
    setFormError(null);
    const id = useHalo.getState().addFeed(property.id, { source, url: url.trim() });
    setUrl("");
    setBusy(id);
    const fresh = useHalo.getState().properties.find((p) => p.id === property.id)!;
    report(await syncFeed(fresh, id));
    setBusy(null);
  };

  return (
    <Card className="h-fit">
      <CardHeader>
        <CardTitle>{t("calendar.feeds")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 pt-2">
        <p className="text-[14px] text-muted">{t("calendar.feedsIntro")}</p>
        {property.feeds.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {property.feeds.map((f) => (
              <li key={f.id} className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2 text-[15px] font-medium">
                    <Link2 className="size-4 shrink-0 text-muted" />
                    {t(`source.${f.source}`)}
                  </span>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      disabled={busy === f.id}
                      onClick={async () => {
                        setBusy(f.id);
                        report(await syncFeed(property, f.id));
                        setBusy(null);
                      }}
                      aria-label={t("calendar.syncNow")}
                    >
                      <RefreshCw className={cn(busy === f.id && "animate-spin")} />
                    </Button>
                    <Button size="icon" variant="ghost" className="text-muted" onClick={() => useHalo.getState().removeFeed(property.id, f.id)} aria-label={t("calendar.removeFeed")}>
                      <Trash2 />
                    </Button>
                  </div>
                </div>
                <p className="truncate text-caption text-muted" title={f.url}>
                  {f.url}
                </p>
                {f.lastError ? (
                  <p className="text-caption text-danger">{t(`calendar.error_${f.lastError}` as "calendar.error_unreachable")}</p>
                ) : f.lastSyncedAt ? (
                  <p className="text-caption text-success">
                    {t("calendar.lastSync", {
                      date: new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(f.lastSyncedAt)),
                    })}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={connect} noValidate className="space-y-3">
          <Field label={t("calendar.source")} htmlFor="f-src">
            <Select id="f-src" value={source} onChange={(e) => setSource(e.target.value as ReservationSource)}>
              {SOURCES.map((s) => (
                <option key={s} value={s}>
                  {t(`source.${s}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("calendar.feedUrl")} htmlFor="f-url" error={formError ?? undefined}>
            <Input id="f-url" type="url" inputMode="url" placeholder="https://www.airbnb.fr/calendar/ical/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          </Field>
          <Button type="submit" variant="secondary" className="w-full" disabled={!url.trim() || busy !== null}>
            <Link2 />
            {t("calendar.connect")}
          </Button>
        </form>

        <details className="rounded-lg bg-subtle p-3 text-[14px] dark:bg-surface-hover">
          <summary className="cursor-pointer font-medium">{t("calendar.whereTitle")}</summary>
          <ul className="mt-2 space-y-2 text-muted">
            <li>
              <strong className="text-fg">Airbnb</strong> — {t("calendar.whereAirbnb")}
            </li>
            <li>
              <strong className="text-fg">Booking.com</strong> — {t("calendar.whereBooking")}
            </li>
            <li>
              <strong className="text-fg">Vrbo</strong> — {t("calendar.whereVrbo")}
            </li>
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
