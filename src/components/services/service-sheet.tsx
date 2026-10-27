"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check, CheckCheck, MessageCircleQuestion, Pencil, XCircle } from "lucide-react";
import type { Property, Reservation, ServiceKind, ServiceRequest } from "@/lib/domain/types";
import { addDaysToKey, localDateKey, localMinutesOfDay, zonedTimeToUtc } from "@/lib/engine/time";
import { useHalo } from "@/lib/store/halo-store";
import { activeStaff, currentManager } from "@/lib/store/selectors";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Stepper } from "@/components/halo/property-create-sheet";
import { Segmented } from "@/components/ui/segmented";
import { isPendingService, SERVICE_ICON, SERVICE_KINDS, SERVICE_POSITION, SERVICE_STATUS_TONE, staffFor } from "./service-meta";
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
  return <ServiceSheetSwitch key={service === "new" ? "new" : service.id} service={service} onClose={onClose} />;
}

/** Une demande existante s'ouvre en lecture ; la modification demande une action explicite. */
function ServiceSheetSwitch({ service, onClose }: { service: ServiceRequest | "new"; onClose: () => void }) {
  const [editing, setEditing] = useState(service === "new");
  // Lecture de la version à jour (après une action)
  const live = useHalo((s) => (service === "new" ? null : s.services.find((x) => x.id === service.id) ?? null));
  if (service !== "new" && !editing) return <ServiceView service={live ?? service} onClose={onClose} onEdit={() => setEditing(true)} />;
  return <ServiceSheetInner service={service === "new" ? "new" : live ?? service} onClose={onClose} onCancel={service === "new" ? onClose : () => setEditing(false)} />;
}

function ServiceView({ service, onClose, onEdit }: { service: ServiceRequest; onClose: () => void; onEdit: () => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const property = useHalo((s) => s.properties.find((p) => p.id === service.propertyId));
  const members = useHalo((s) => s.members);
  const stay = useHalo((s) => s.reservations.find((r) => r.id === service.reservationId));
  const currency = useHalo((s) => s.linenSettings.currency);
  const [noteFor, setNoteFor] = useState<"info_requested" | "declined" | null>(null);
  const [note, setNote] = useState("");
  const tz = property?.timezone ?? "UTC";
  const who = members.find((m) => m.id === service.assigneeId);
  const managerName = currentManager(members)?.name;
  const when = `${new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(service.startAt))} · ${hhmm(localMinutesOfDay(new Date(service.startAt), tz))}`;

  const act = (status: ServiceRequest["status"], statusNote?: string) => {
    useHalo.getState().setServiceStatus(service.id, status, managerName, statusNote);
    // Aucun message n'est envoyé au voyageur : on le dit
    toast(t(`services.toast_${status}`), { description: service.source === "guest" ? t("services.guestNotNotified") : undefined });
    setNoteFor(null);
    setNote("");
  };

  const rows: [string, string | undefined][] = [
    [t("services.property"), property?.name],
    [t("services.stay"), stay ? `${stay.guestName ?? t(`source.${stay.source}`)}${stay.vip ? " · VIP" : ""}` : service.guestName],
    [t("services.date"), when],
    [t("services.people"), service.people ? String(service.people) : undefined],
    [t("services.assignee"), who ? who.name : service.provider ?? t("services.nobody")],
    [t("services.price"), service.price !== undefined ? new Intl.NumberFormat(locale, { style: "currency", currency }).format(service.price) : undefined],
  ];

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent title={t(`serviceKind.${service.kind}`)} closeLabel={t("common.close")}>
        <div className="min-w-0 space-y-4 pt-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={SERVICE_STATUS_TONE[service.status]}>{t(`serviceStatus.${service.status}`)}</Badge>
            <Badge>{t(`services.from_${service.source}`)}</Badge>
          </div>
          {service.statusNote && (
            <p className="rounded-lg bg-subtle p-3 text-[14px] dark:bg-surface-hover">
              <span className="block text-caption text-muted">{t(`services.noteLabel_${service.status === "declined" ? "declined" : "info_requested"}`)}</span>
              {service.statusNote}
            </p>
          )}
          <dl className="divide-y divide-line rounded-lg border border-line">
            {rows
              .filter(([, v]) => v)
              .map(([k, v]) => (
                <div key={k} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <dt className="shrink-0 text-[14px] text-muted">{k}</dt>
                  <dd className="text-end text-[15px] font-medium first-letter:uppercase">{v}</dd>
                </div>
              ))}
          </dl>
          {service.details && (
            <div>
              <p className="mb-1 text-caption text-muted">{t("services.details")}</p>
              <p className="whitespace-pre-line text-[15px]">{service.details}</p>
            </div>
          )}

          {/* Décisions : trois actions distinctes, chacune explicite */}
          {isPendingService(service) && noteFor === null && (
            <div className="grid gap-2">
              <Button type="button" size="xl" onClick={() => act("confirmed")}>
                <Check />
                {t("services.accept")}
              </Button>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="button" size="lg" variant="secondary" className="min-w-0 whitespace-normal" onClick={() => setNoteFor("info_requested")}>
                  <MessageCircleQuestion />
                  {t("services.askInfo")}
                </Button>
                <Button type="button" size="lg" variant="secondary" className="min-w-0 whitespace-normal text-danger" onClick={() => setNoteFor("declined")}>
                  <XCircle />
                  {t("services.decline")}
                </Button>
              </div>
            </div>
          )}
          {noteFor && (
            <div className="space-y-3 rounded-lg border border-line p-3">
              <Field label={t(`services.noteLabel_${noteFor}`)} htmlFor="s-note" hint={t("services.guestNotNotified")}>
                <Textarea id="s-note" value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
              </Field>
              <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <Button type="button" variant="ghost" onClick={() => setNoteFor(null)}>
                  {t("form.cancel")}
                </Button>
                <Button type="button" className="min-w-0 whitespace-normal" disabled={!note.trim()} onClick={() => act(noteFor, note)}>
                  {noteFor === "declined" ? t("services.confirmDecline") : t("services.saveInfo")}
                </Button>
              </div>
            </div>
          )}
          {service.status === "confirmed" && (
            <Button type="button" size="xl" className="bg-success hover:bg-success hover:opacity-90" onClick={() => act("done")}>
              <CheckCheck />
              {t("services.markDone")}
            </Button>
          )}
          {noteFor === null && (
            <Button type="button" size="lg" variant="secondary" className="w-full" onClick={onEdit}>
              <Pencil />
              {t("services.edit")}
            </Button>
          )}
          {service.status === "confirmed" && (
            <Button type="button" variant="ghost" className="w-full text-danger" onClick={() => act("cancelled")}>
              <XCircle />
              {t("services.cancel")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ServiceSheetInner({ service, onClose, onCancel }: { service: ServiceRequest | "new"; onClose: () => void; onCancel: () => void }) {
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
  const save = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!propertyId) return;
    const d = data();
    if (isNew) {
      addService({ ...d, source: "manager", status: d.assigneeId || d.provider ? "confirmed" : "requested" });
      toast(t("services.toast_requested"));
      onClose();
    } else {
      // Modifier les détails ne change jamais le statut (accepter / refuser se font depuis la fiche)
      updateService(service.id, d);
      toast(t("form.saved"));
      onCancel();
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent
        title={isNew ? t("services.new") : t("services.editTitle", { kind: t(`serviceKind.${service.kind}`) })}
        description={isNew ? t("services.newHint") : undefined}
        closeLabel={t("common.close")}
      >
        <form onSubmit={save} className="space-y-4 pt-2">
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

          <div className="grid gap-2">
            <Button type="submit" size="xl">
              {isNew ? t("services.create") : t("form.save")}
            </Button>
            <Button type="button" size="lg" variant="ghost" onClick={onCancel}>
              {t("form.cancel")}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
