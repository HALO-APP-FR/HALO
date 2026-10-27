"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Camera, Eye, EyeOff, Plus, Sparkles, Trash2 } from "lucide-react";
import type { AccessType, BedSize, ChecklistRoom, Property } from "@/lib/domain/types";
import { COUNTRY_TZ, allTimezones, sortedCountries, timezoneLabel } from "@/lib/domain/geo";
import { CHECKLIST_TEMPLATES, buildChecklist, newId } from "@/lib/domain/templates";
import { LEARN_MIN_SAMPLES, formatDuration, learnedCleaningDuration } from "@/lib/engine/learning";
import { useHalo } from "@/lib/store/halo-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SwitchRow } from "@/components/ui/switch";
import { deletePhoto } from "@/lib/store/photos";
import { AmenitiesPicker } from "./amenities-picker";
import { AddPhotoButton, PhotoThumb } from "./photo-thumb";
import { BED_SIZES, Stepper } from "./property-create-sheet";
import { cn } from "@/lib/utils";

function SaveBar({ dirty, onSave, onReset }: { dirty: boolean; onSave: () => void; onReset: () => void }) {
  const t = useTranslations("form");
  if (!dirty) return null;
  return (
    <div className="sticky bottom-20 z-10 mt-4 flex items-center justify-end gap-2 rounded-lg border border-line bg-surface/95 p-3 shadow-float backdrop-blur md:bottom-4">
      <Button variant="ghost" onClick={onReset}>
        {t("cancel")}
      </Button>
      <Button onClick={onSave}>{t("save")}</Button>
    </div>
  );
}

/** Durée apprise des pointages : la conciergerie voit d'où vient le chiffre et peut couper l'ajustement. */
function LearnedDurationRow({ property, enabled, onChange }: { property: Property; enabled: boolean; onChange: (v: boolean) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const tasks = useHalo((s) => s.tasks);
  const learned = learnedCleaningDuration(property.id, tasks);
  return (
    <div className="rounded-lg border border-line p-3">
      <SwitchRow id="i-learn" label={t("property.learnDuration")} description={t("property.learnDurationHint")} checked={enabled} onCheckedChange={onChange} />
      <p className="mt-1 flex items-center gap-1.5 text-caption text-muted">
        <Sparkles className="size-3.5 text-accent-text" />
        {learned
          ? t("property.learnedValue", { time: formatDuration(learned.minutes, locale), count: learned.samples })
          : t("property.learnedNone", { count: LEARN_MIN_SAMPLES })}
      </p>
    </div>
  );
}

/* ---------------- Infos ---------------- */
export function PropertyInfoForm({ property }: { property: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  const [draft, setDraft] = useState(property);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Property>(k: K, v: Property[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const editable = (p: Property) =>
    JSON.stringify([p.name, p.addressLine, p.postalCode, p.city, p.area, p.countryCode, p.timezone, p.capacity, p.defaultCheckIn, p.defaultCheckOut, p.cleaningDurationMin, p.learnDuration !== false, p.checkInService, p.checkOutService, p.instructions]);
  const dirty = editable(draft) !== editable(property);

  const save = () => {
    if (!draft.name.trim() || !draft.city.trim()) {
      setError(t("form.required"));
      return;
    }
    setError(null);
    useHalo.getState().updateProperty(property.id, {
      name: draft.name.trim(),
      addressLine: draft.addressLine,
      postalCode: draft.postalCode,
      city: draft.city.trim(),
      area: draft.area,
      countryCode: draft.countryCode,
      timezone: draft.timezone,
      capacity: draft.capacity,
      defaultCheckIn: draft.defaultCheckIn,
      defaultCheckOut: draft.defaultCheckOut,
      cleaningDurationMin: draft.cleaningDurationMin,
      learnDuration: draft.learnDuration !== false,
      checkInService: draft.checkInService,
      checkOutService: draft.checkOutService,
      instructions: draft.instructions,
    });
    toast(t("form.saved"));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2 lg:gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t("property.identity")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label={t("property.name")} htmlFor="i-name" error={error && !draft.name.trim() ? error : undefined}>
            <Input id="i-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field label={t("property.address")} htmlFor="i-address">
            <Input id="i-address" value={draft.addressLine ?? ""} onChange={(e) => set("addressLine", e.target.value)} />
          </Field>
          <div className="grid grid-cols-[120px_1fr] gap-3">
            <Field label={t("property.postalCode")} htmlFor="i-postal">
              <Input id="i-postal" value={draft.postalCode ?? ""} onChange={(e) => set("postalCode", e.target.value)} />
            </Field>
            <Field label={t("property.city")} htmlFor="i-city" error={error && !draft.city.trim() ? error : undefined}>
              <Input id="i-city" value={draft.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
          </div>
          <Field label={t("property.area")} htmlFor="i-area">
            <Input id="i-area" value={draft.area ?? ""} onChange={(e) => set("area", e.target.value)} />
          </Field>
          <Field label={t("property.country")} htmlFor="i-country">
            <Select
              id="i-country"
              value={draft.countryCode}
              onChange={(e) => {
                set("countryCode", e.target.value);
                if (COUNTRY_TZ[e.target.value]) set("timezone", COUNTRY_TZ[e.target.value]);
              }}
            >
              {sortedCountries(locale).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("property.timezone")} htmlFor="i-tz" hint={t("property.timezoneHint")}>
            <Select id="i-tz" value={draft.timezone} onChange={(e) => set("timezone", e.target.value)}>
              {allTimezones().map((tz) => (
                <option key={tz} value={tz}>
                  {timezoneLabel(tz, locale)}
                </option>
              ))}
            </Select>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("property.operations")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[15px]">{t("property.capacity")}</span>
            <Stepper label={t("property.capacity")} value={draft.capacity} onChange={(v) => set("capacity", v)} min={1} max={30} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("property.checkIn")} htmlFor="i-in">
              <Input id="i-in" type="time" step={900} value={draft.defaultCheckIn} onChange={(e) => set("defaultCheckIn", e.target.value)} />
            </Field>
            <Field label={t("property.checkOut")} htmlFor="i-out">
              <Input id="i-out" type="time" step={900} value={draft.defaultCheckOut} onChange={(e) => set("defaultCheckOut", e.target.value)} />
            </Field>
          </div>
          <Field label={t("property.cleaningDuration")} htmlFor="i-dur">
            <Select id="i-dur" value={draft.cleaningDurationMin} onChange={(e) => set("cleaningDurationMin", Number(e.target.value))}>
              {Array.from({ length: 24 }, (_, i) => (i + 2) * 15).map((m) => (
                <option key={m} value={m}>
                  {t("time.duration", { hours: Math.floor(m / 60), minutes: m % 60 })}
                </option>
              ))}
            </Select>
          </Field>
          <LearnedDurationRow property={property} enabled={draft.learnDuration !== false} onChange={(v) => set("learnDuration", v)} />
          <div className="divide-y divide-line">
            <SwitchRow id="i-cis" label={t("property.checkInService")} description={t("property.checkInServiceHint")} checked={draft.checkInService} onCheckedChange={(v) => set("checkInService", v)} />
            <SwitchRow id="i-cos" label={t("property.checkOutService")} description={t("property.checkOutServiceHint")} checked={draft.checkOutService} onCheckedChange={(v) => set("checkOutService", v)} />
          </div>
          <Field label={t("property.instructions")} htmlFor="i-instr" hint={t("property.instructionsHint")}>
            <Textarea id="i-instr" value={draft.instructions ?? ""} onChange={(e) => set("instructions", e.target.value)} />
          </Field>
        </CardContent>
      </Card>
      <div className="lg:col-span-2">
        <SaveBar dirty={dirty} onSave={save} onReset={() => setDraft(property)} />
      </div>
    </div>
  );
}

/* ---------------- Accès ---------------- */
const ACCESS_TYPES: AccessType[] = ["key_box", "keypad", "smart_lock", "in_person", "other"];

export function PropertyAccessForm({ property }: { property: Property }) {
  const t = useTranslations();
  const [draft, setDraft] = useState(property.access);
  const [show, setShow] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(property.access);
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("property.accessTitle")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label={t("property.accessType")} htmlFor="a-type">
          <Select id="a-type" value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as AccessType })}>
            {ACCESS_TYPES.map((a) => (
              <option key={a} value={a}>
                {t(`access.${a}`)}
              </option>
            ))}
          </Select>
        </Field>
        {draft.type !== "in_person" && (
          <Field label={t("property.accessCode")} htmlFor="a-code" hint={t("property.accessCodeHint")}>
            <div className="relative">
              <Input
                id="a-code"
                type={show ? "text" : "password"}
                autoComplete="off"
                value={draft.code ?? ""}
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
                className="pe-11 text-[17px] tracking-[0.2em] tabular"
              />
              <button
                type="button"
                onClick={() => setShow(!show)}
                className="absolute end-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-fg"
                aria-label={show ? t("property.hideCode") : t("property.showCode")}
              >
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        )}
        <Field label={t("property.accessInstructions")} htmlFor="a-instr">
          <Textarea id="a-instr" value={draft.instructions ?? ""} onChange={(e) => setDraft({ ...draft, instructions: e.target.value })} />
        </Field>
        <SaveBar
          dirty={dirty}
          onReset={() => setDraft(property.access)}
          onSave={() => {
            useHalo.getState().updateProperty(property.id, { access: draft });
            toast(t("form.saved"));
          }}
        />
      </CardContent>
    </Card>
  );
}

/* ---------------- Lits ---------------- */
export function PropertyBedsForm({ property }: { property: Property }) {
  const t = useTranslations();
  const [beds, setBeds] = useState(property.beds);
  const dirty = JSON.stringify(beds) !== JSON.stringify(property.beds);
  return (
    <Card className="max-w-xl">
      <CardHeader>
        <CardTitle>{t("property.bedsTitle")}</CardTitle>
        <Button size="sm" variant="secondary" onClick={() => setBeds([...beds, { id: newId("bed"), size: "double" }])}>
          <Plus />
          {t("property.addBed")}
        </Button>
      </CardHeader>
      <CardContent>
        {beds.length === 0 ? (
          <p className="text-[14px] text-muted">{t("propertyNew.atLeastOneBed")}</p>
        ) : (
          <ul className="space-y-2">
            {beds.map((bed, i) => (
              <li key={bed.id} className="grid grid-cols-[1fr_1fr_auto] items-center gap-2">
                <Select
                  aria-label={t("property.bedSize")}
                  value={bed.size}
                  onChange={(e) => setBeds(beds.map((b) => (b.id === bed.id ? { ...b, size: e.target.value as BedSize } : b)))}
                >
                  {BED_SIZES.map((s) => (
                    <option key={s} value={s}>
                      {t(`bed.${s}`)}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={t("property.bedLabel")}
                  placeholder={t("property.bedLabelPlaceholder", { n: i + 1 })}
                  value={bed.label ?? ""}
                  onChange={(e) => setBeds(beds.map((b) => (b.id === bed.id ? { ...b, label: e.target.value } : b)))}
                />
                <Button size="icon" variant="ghost" className="text-muted" onClick={() => setBeds(beds.filter((b) => b.id !== bed.id))} aria-label={t("form.remove")}>
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-4 text-caption text-muted">{t("property.linenSoon")}</p>
        <SaveBar
          dirty={dirty}
          onReset={() => setBeds(property.beds)}
          onSave={() => {
            useHalo.getState().updateProperty(property.id, { beds });
            toast(t("form.saved"));
          }}
        />
      </CardContent>
    </Card>
  );
}

/* ---------------- Checklist (enregistrement automatique) ---------------- */
export function PropertyChecklistEditor({ property }: { property: Property }) {
  const t = useTranslations();
  const locale = useLocale();
  const rooms = property.checklist;
  const [newItem, setNewItem] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState(CHECKLIST_TEMPLATES[0].key);
  const [confirmTemplate, setConfirmTemplate] = useState(false);
  const save = (checklist: ChecklistRoom[]) => useHalo.getState().updateProperty(property.id, { checklist });
  const updateRoom = (roomId: string, fn: (r: ChecklistRoom) => ChecklistRoom) => save(rooms.map((r) => (r.id === roomId ? fn(r) : r)));
  const moveItem = (roomId: string, index: number, delta: number) =>
    updateRoom(roomId, (r) => {
      const items = [...r.items];
      const target = index + delta;
      if (target < 0 || target >= items.length) return r;
      [items[index], items[target]] = [items[target], items[index]];
      return { ...r, items };
    });
  const photoCount = rooms.reduce((n, r) => n + r.items.filter((i) => i.photoRequired).length, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px] text-muted">
          {t("checklist.summary", { rooms: rooms.length, photos: photoCount })} · {t("checklist.autosave")}
          <span className="mt-1 block text-caption">{t("checklist.legend")}</span>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t("checklist.template")} value={template} onChange={(e) => setTemplate(e.target.value)} className="h-9 w-48">
            {CHECKLIST_TEMPLATES.map((tpl) => (
              <option key={tpl.key} value={tpl.key}>
                {t(`checklist.tpl_${tpl.key}`)}
              </option>
            ))}
          </Select>
          {confirmTemplate ? (
            <>
              <Button
                size="sm"
                variant="danger"
                onClick={() => {
                  save(buildChecklist(template, locale));
                  setConfirmTemplate(false);
                  toast(t("checklist.replaced"));
                }}
              >
                {t("checklist.confirmReplace")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmTemplate(false)}>
                {t("form.cancel")}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setConfirmTemplate(true)}>
              {t("checklist.useTemplate")}
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {rooms.map((room) => (
          <Card key={room.id}>
            <div className="flex items-center gap-2 px-4 pt-4">
              <Input
                aria-label={t("checklist.roomName")}
                value={room.name}
                onChange={(e) => updateRoom(room.id, (r) => ({ ...r, name: e.target.value }))}
                className="h-9 border-transparent px-1 text-title-3 hover:border-line focus:border-accent"
              />
              <Button size="icon" variant="ghost" className="shrink-0 text-muted" onClick={() => save(rooms.filter((r) => r.id !== room.id))} aria-label={t("checklist.removeRoom")}>
                <Trash2 />
              </Button>
            </div>
            <ul className="mt-2 divide-y divide-line px-4">
              {room.items.map((item, index) => (
                <li key={item.id} className="py-2">
                  <div className="flex items-center gap-1">
                    <Input
                      aria-label={t("checklist.itemLabel")}
                      value={item.label}
                      onChange={(e) => updateRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, label: e.target.value } : i)) }))}
                      className="h-9 min-w-0 flex-1 border-transparent px-1 hover:border-line focus:border-accent"
                    />
                    <button type="button" onClick={() => moveItem(room.id, index, -1)} disabled={index === 0} className="grid size-8 shrink-0 place-items-center rounded-md text-faint hover:text-fg disabled:opacity-30" aria-label={t("checklist.moveUp")}>
                      <ArrowUp className="size-4" />
                    </button>
                    <button type="button" onClick={() => moveItem(room.id, index, 1)} disabled={index === room.items.length - 1} className="grid size-8 shrink-0 place-items-center rounded-md text-faint hover:text-fg disabled:opacity-30" aria-label={t("checklist.moveDown")}>
                      <ArrowDown className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        (item.referencePhotoIds ?? []).forEach((pid) => void deletePhoto(pid));
                        updateRoom(room.id, (r) => ({ ...r, items: r.items.filter((i) => i.id !== item.id) }));
                      }}
                      className="grid size-8 shrink-0 place-items-center rounded-md text-faint hover:text-danger"
                      aria-label={t("form.remove")}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 ps-1">
                    {/* Interrupteur explicite : photo exigée de l'agent */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={item.photoRequired}
                      onClick={() => {
                        updateRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, photoRequired: !i.photoRequired } : i)) }));
                        toast(item.photoRequired ? t("checklist.photoRequiredOff") : t("checklist.photoRequiredOn"));
                      }}
                      className={cn(
                        "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                        item.photoRequired ? "border-accent bg-accent text-on-accent" : "border-line text-muted hover:text-fg",
                      )}
                    >
                      <Camera className="size-3.5" />
                      {item.photoRequired ? t("checklist.photoOn") : t("checklist.photoOff")}
                    </button>
                    {(item.referencePhotoIds ?? []).map((pid) => (
                      <PhotoThumb
                        key={pid}
                        id={pid}
                        size="sm"
                        label={item.label}
                        onRemove={() => {
                          void deletePhoto(pid);
                          updateRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, referencePhotoIds: (i.referencePhotoIds ?? []).filter((x) => x !== pid) } : i)) }));
                        }}
                      />
                    ))}
                    <AddPhotoButton
                      compact={(item.referencePhotoIds ?? []).length > 0}
                      className={(item.referencePhotoIds ?? []).length > 0 ? "size-12" : "h-8 min-w-0 rounded-full px-3"}
                      label={t("checklist.addReference")}
                      onAdded={(pid) =>
                        updateRoom(room.id, (r) => ({ ...r, items: r.items.map((i) => (i.id === item.id ? { ...i, referencePhotoIds: [...(i.referencePhotoIds ?? []), pid] } : i)) }))
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
            <form
              className="flex gap-2 p-4"
              onSubmit={(e) => {
                e.preventDefault();
                const label = (newItem[room.id] ?? "").trim();
                if (!label) return;
                updateRoom(room.id, (r) => ({ ...r, items: [...r.items, { id: newId("item"), label, photoRequired: false }] }));
                setNewItem({ ...newItem, [room.id]: "" });
              }}
            >
              <Input
                aria-label={t("checklist.newItem")}
                placeholder={t("checklist.newItem")}
                value={newItem[room.id] ?? ""}
                onChange={(e) => setNewItem({ ...newItem, [room.id]: e.target.value })}
                className="h-9"
              />
              <Button type="submit" size="icon" variant="secondary" aria-label={t("checklist.addItem")}>
                <Plus />
              </Button>
            </form>
          </Card>
        ))}
        <button
          type="button"
          onClick={() => save([...rooms, { id: newId("room"), name: t("checklist.newRoom"), items: [] }])}
          className="flex min-h-32 items-center justify-center gap-2 rounded-lg border border-dashed border-line-strong text-[15px] font-medium text-muted transition-colors hover:bg-surface hover:text-fg"
        >
          <Plus className="size-5" />
          {t("checklist.addRoom")}
        </button>
      </div>
    </div>
  );
}

/* ---------------- Équipements ---------------- */
export function PropertyAmenitiesForm({ property }: { property: Property }) {
  const t = useTranslations();
  const [amenities, setAmenities] = useState(property.amenities);
  const [custom, setCustom] = useState(property.customAmenities);
  const dirty = JSON.stringify([amenities, custom]) !== JSON.stringify([property.amenities, property.customAmenities]);
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>{t("amenities.title")}</CardTitle>
          <p className="mt-1 text-caption text-muted">{t("amenities.hint", { count: amenities.length + custom.length })}</p>
        </div>
      </CardHeader>
      <CardContent>
        <AmenitiesPicker value={amenities} custom={custom} onChange={setAmenities} onCustomChange={setCustom} />
        <SaveBar
          dirty={dirty}
          onReset={() => {
            setAmenities(property.amenities);
            setCustom(property.customAmenities);
          }}
          onSave={() => {
            useHalo.getState().updateProperty(property.id, { amenities, customAmenities: custom });
            toast(t("form.saved"));
          }}
        />
      </CardContent>
    </Card>
  );
}
