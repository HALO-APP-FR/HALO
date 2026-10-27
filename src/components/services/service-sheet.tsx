"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCheck, XCircle } from "lucide-react";
import type { Property, Reservation, ServiceKind, ServiceRequest } from "@/lib/domain/types";
import { addDaysToKey, localDateKey, localMinutesOfDay, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { activeStaff } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Stepper } from "@/components/halo/property-create-sheet";
import { Segmented } from "@/components/ui/segmented";
import { SERVICE_ICON, SERVICE_KINDS, SERVICE_POSITION, SERVICE_STATUS_TONE, staffFor } from "./service-meta";
import { cn } from "@/lib/utils";

const hhmm = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Grille de choix d'une prestation. */
export function KindPicker({ value, onChange }: { value: ServiceKind; onChange: (k: ServiceKind) => void }) {
  const t = useTranslations();
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t("services.kind")}>
      {SERVICE_KINDS.map((k) => {
        const Icon = SERVICE_ICON[k];
        const on = value === k;
        return (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(k)}
            className={cn(
              "flex min-h-12 items-center gap-2 rounded-lg border px-3 py-2 text-start text-[14px] font-medium transition-colors",
              on ? "border-vip bg-vip-soft text-vip" : "border-line bg-surface hover:bg-surface-hover",
            )}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.9} />
            {t(`serviceKind.${k}`)}
          </button>
        );
      })}
    </div>
  );
}

/** Demande de prestation côté voyageur (depuis le livret). */
export function GuestServiceSheet({
  open,
  onOpenChange,
  property,
  stay,
  initialKind,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property: Property;
  stay?: Reservation;
  initialKind: ServiceKind;
}) {
  const t = useTranslations();
  const tz = property.timezone;
  const todayKey = localDateKey(new Date(), tz);
  const [kind, setKind] = useState<ServiceKind>(initialKind);
  const [lastKind, setLastKind] = useState(initialKind);
  if (initialKind !== lastKind) {
    setLastKind(initialKind);
    setKind(initialKind);
  }
  const [date, setDate] = useState(todayKey);
  const [time, setTime] = useState("20:00");
  const [people, setPeople] = useState(stay?.guestsCount ?? 2);
  const [details, setDetails] = useState("");
  const [name, setName] = useState(stay?.guestName ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    useHalo.getState().addService({
      propertyId: property.id,
      reservationId: stay?.id,
      kind,
      startAt: zonedTimeToUtc(date, time, tz).toISOString(),
      people,
      details: details.trim() || undefined,
      guestName: name.trim() || undefined,
      source: "guest",
    });
    toast(t("services.requestSent"));
    setDetails("");
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent title={t("services.requestTitle")} description={t("services.requestHint")} closeLabel={t("common.close")}>
        <form onSubmit={submit} className="space-y-4 pt-2">
          <KindPicker value={kind} onChange={setKind} />
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("services.date")} htmlFor="g-date">
              <Input id="g-date" type="date" min={todayKey} value={date} onChange={(e) => setDate(e.target.value || todayKey)} required />
            </Field>
            <Field label={t("services.time")} htmlFor="g-time">
              <Input id="g-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value || "20:00")} required />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-2">
            <span className="text-[15px]">{t("services.people")}</span>
            <Stepper label={t("services.people")} value={people} min={1} max={30} onChange={setPeople} />
          </div>
          <Field label={t("services.details")} htmlFor="g-details">
            <Textarea id="g-details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t("services.detailsPlaceholder")} />
          </Field>
          <Field label={t("alerts.yourName")} htmlFor="g-name">
            <Input id="g-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </Field>
          <Button type="submit" size="xl">
            {t("services.sendRequest")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

/** Création / suivi d'une prestation côté conciergerie. */
export function ServiceSheet({ service, onClose }: { service: ServiceRequest | "new" | null; onClose: () => void }) {
  if (!service) return null;
  return <ServiceSheetInner key={service === "new" ? "new" : service.id} service={service} onClose={onClose} />;
}

function ServiceSheetInner({ service, onClose }: { service: ServiceRequest | "new"; onClose: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const isNew = service === "new";
  const properties = useHalo((s) => s.properties);
  const reservations = useHalo((s) => s.reservations);
  const members = useHalo((s) => s.members);
  const currency = useHalo((s) => s.linenSettings.currency);
  const active = properties.filter((p) => !p.archived);

  const [propertyId, setPropertyId] = useState(isNew ? active[0]?.id ?? "" : service.propertyId);
  const property = properties.find((p) => p.id === propertyId);
  const tz = property?.timezone ?? "UTC";
  const startDate = isNew ? undefined : new Date(service.startAt);
  const [kind, setKind] = useState<ServiceKind>(isNew ? "private_chef" : service.kind);
  const [reservationId, setReservationId] = useState(isNew ? "" : service.reservationId ?? "");
  const [date, setDate] = useState(startDate ? localDateKey(startDate, tz) : localDateKey(new Date(), tz));
  const [time, setTime] = useState(startDate ? hhmm(localMinutesOfDay(startDate, tz)) : "20:00");
  const [people, setPeople] = useState(isNew ? 2 : service.people ?? 2);
  const [details, setDetails] = useState(isNew ? "" : service.details ?? "");
  const [assigneeId, setAssigneeId] = useState(isNew ? "" : service.assigneeId ?? "");
  const [provider, setProvider] = useState(isNew ? "" : service.provider ?? "");
  const [price, setPrice] = useState(isNew || service.price === undefined ? "" : String(service.price));

  const now = new Date();
  const stays = reservations
    .filter((r) => r.propertyId === propertyId && r.status === "confirmed" && new Date(r.checkOutAt) > new Date(now.getTime() - 86_400_000))
    .sort((a, b) => a.checkInAt.localeCompare(b.checkInAt))
    .slice(0, 6);
  // Seuls les membres dont le poste correspond à la prestation sont proposés
  const staff = staffFor(kind, activeStaff(members));
  const [mode, setMode] = useState<"team" | "partner" | "none">(isNew ? "none" : service.assigneeId ? "team" : service.provider ? "partner" : "none");
  const stay = reservations.find((r) => r.id === reservationId);
  const fmtStay = (r: Reservation) =>
    `${r.guestName ?? t(`source.${r.source}`)} · ${new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "short" }).format(new Date(r.checkInAt))} → ${new Intl.DateTimeFormat(locale, { timeZone: tz, day: "numeric", month: "short" }).format(new Date(r.checkOutAt))}${r.vip ? " · VIP" : ""}`;

  const data = () => ({
    propertyId,
    reservationId: reservationId || undefined,
    guestName: stay?.guestName ?? (isNew ? undefined : service.guestName),
    kind,
    startAt: zonedTimeToUtc(date, time, tz).toISOString(),
    people,
    details: details.trim() || undefined,
    // Un seul responsable : membre de l'équipe OU partenaire externe
    assigneeId: mode === "team" && staff.some((m) => m.id === assigneeId) ? assigneeId : undefined,
    provider: mode === "partner" ? provider.trim() || undefined : undefined,
    price: price.trim() ? Math.max(0, Number(price.replace(",", ".")) || 0) : undefined,
  });

  const { addService, updateService } = useHalo.getState();
  const save = (e?: React.FormEvent, status?: ServiceRequest["status"]) => {
    e?.preventDefault();
    if (!propertyId) return;
    const d = data();
    if (isNew) addService({ ...d, source: "manager", status: status ?? (d.assigneeId || d.provider ? "confirmed" : "requested") });
    else updateService(service.id, { ...d, ...(status ? { status } : {}) });
    toast(status ? t(`services.toast_${status}`) : t("form.saved"));
    onClose();
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={isNew ? t("services.new") : t(`serviceKind.${service.kind}`)}
        description={isNew ? t("services.newHint") : undefined}
        closeLabel={t("common.close")}
      >
        <form onSubmit={save} className="space-y-4 pt-2">
          {!isNew && (
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SERVICE_STATUS_TONE[service.status]}>{t(`serviceStatus.${service.status}`)}</Badge>
              <Badge>{t(`services.from_${service.source}`)}</Badge>
            </div>
          )}
          <KindPicker value={kind} onChange={setKind} />
          <Field label={t("services.property")} htmlFor="s-prop">
            <Select
              id="s-prop"
              value={propertyId}
              onChange={(e) => {
                setPropertyId(e.target.value);
                setReservationId("");
              }}
            >
              {active.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("services.stay")} htmlFor="s-stay">
            <Select id="s-stay" value={reservationId} onChange={(e) => setReservationId(e.target.value)}>
              <option value="">{t("services.noStay")}</option>
              {stays.map((r) => (
                <option key={r.id} value={r.id}>
                  {fmtStay(r)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("services.date")} htmlFor="s-date">
              <Input id="s-date" type="date" min={addDaysToKey(localDateKey(now, tz), -30)} value={date} onChange={(e) => setDate(e.target.value || date)} required />
            </Field>
            <Field label={t("services.time")} htmlFor="s-time">
              <Input id="s-time" type="time" step={900} value={time} onChange={(e) => setTime(e.target.value || time)} required />
            </Field>
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-4 py-2">
            <span className="text-[15px]">{t("services.people")}</span>
            <Stepper label={t("services.people")} value={people} min={1} max={30} onChange={setPeople} />
          </div>
          <Field label={t("services.details")} htmlFor="s-details">
            <Textarea id="s-details" value={details} onChange={(e) => setDetails(e.target.value)} placeholder={t("services.detailsPlaceholder")} />
          </Field>
          <fieldset className="space-y-3">
            <legend className="mb-2 text-[13px] font-medium text-muted">{t("services.assignee")}</legend>
            <Segmented
              label={t("services.assignee")}
              value={mode}
              onChange={setMode}
              options={[
                { value: "team", label: t("services.modeTeam") },
                { value: "partner", label: t("services.modePartner") },
                { value: "none", label: t("services.modeNone") },
              ]}
              className="flex w-full [&>*]:flex-1"
            />
            {mode === "team" &&
              (staff.length === 0 ? (
                <p className="rounded-lg bg-warning-soft p-3 text-[14px] text-warning">
                  {t("services.noStaffForKind", { position: t(`position.${SERVICE_POSITION[kind]}`) })}
                </p>
              ) : (
                <Field label={t("services.member")} htmlFor="s-who" hint={t("services.assigneeHint", { position: t(`position.${SERVICE_POSITION[kind]}`) })}>
                  <Select id="s-who" value={staff.some((m) => m.id === assigneeId) ? assigneeId : ""} onChange={(e) => setAssigneeId(e.target.value)}>
                    <option value="">{t("services.chooseMember")}</option>
                    {staff.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} — {t(`position.${m.position ?? "housekeeper"}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
              ))}
            {mode === "partner" && (
              <Field label={t("services.provider")} htmlFor="s-provider">
                <Input id="s-provider" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder={t("services.providerPlaceholder")} />
              </Field>
            )}
          </fieldset>
          <Field label={`${t("services.price")} (${currency})`} htmlFor="s-price">
            <Input id="s-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} className="w-40 tabular" />
          </Field>

          {isNew ? (
            <Button type="submit" size="xl">
              {t("services.create")}
            </Button>
          ) : (
            <div className="grid gap-2">
              {service.status === "requested" && (
                <Button type="button" size="xl" onClick={() => save(undefined, "confirmed")}>
                  <Check />
                  {t("services.confirm")}
                </Button>
              )}
              {service.status === "confirmed" && (
                <Button type="button" size="xl" className="bg-success hover:bg-success hover:opacity-90" onClick={() => save(undefined, "done")}>
                  <CheckCheck />
                  {t("services.markDone")}
                </Button>
              )}
              <Button type="submit" size="lg" variant="secondary">
                {t("form.save")}
              </Button>
              {service.status !== "cancelled" && service.status !== "done" && (
                <Button type="button" variant="ghost" className="text-danger" onClick={() => save(undefined, "cancelled")}>
                  <XCircle />
                  {t("services.cancel")}
                </Button>
              )}
            </div>
          )}
        </form>
      </SheetContent>
    </Sheet>
  );
}
