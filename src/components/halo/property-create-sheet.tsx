"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check, Minus, Plus } from "lucide-react";
import { useRouter } from "@/i18n/navigation";
import type { BedSize } from "@/lib/domain/types";
import { COUNTRY_TZ, allTimezones, sortedCountries, timezoneLabel } from "@/lib/domain/geo";
import { buildChecklist, newId, suggestedCleaningDuration, suggestedTemplate } from "@/lib/domain/templates";
import { useHalo } from "@/lib/store/halo-store";
import { Button } from "@/components/ui/button";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const BED_SIZES: BedSize[] = ["single", "double", "queen", "king", "sofa_bed"];

/** Compteur +/− à grosses touches. */
export function Stepper({ value, onChange, min = 0, max = 20, label }: { value: number; onChange: (v: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      <Button type="button" variant="secondary" size="icon" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="−">
        <Minus />
      </Button>
      <span className="w-8 text-center text-[17px] font-semibold tabular" aria-live="polite">
        {value}
      </span>
      <Button type="button" variant="secondary" size="icon" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="+">
        <Plus />
      </Button>
    </div>
  );
}

export function PropertyCreateSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const org = useHalo((s) => s.org);
  const { addProperty } = useHalo.getState();

  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [city, setCity] = useState("");
  const [area, setArea] = useState("");
  const [countryCode, setCountryCode] = useState(org.countryCode);
  const [timezone, setTimezone] = useState(org.timezone);
  const [beds, setBeds] = useState<Record<BedSize, number>>({ single: 0, double: 1, queen: 0, king: 0, sofa_bed: 0 });
  const [capacity, setCapacity] = useState(2);
  const [checkIn, setCheckIn] = useState("16:00");
  const [checkOut, setCheckOut] = useState("11:00");
  const [duration, setDuration] = useState<number | null>(null);
  const [checkInService, setCheckInService] = useState(false);
  const [checkOutService, setCheckOutService] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const bedCount = Object.values(beds).reduce((a, b) => a + b, 0);
  const suggested = suggestedCleaningDuration(capacity, bedCount);
  const steps = [t("propertyNew.stepPlace"), t("propertyNew.stepBeds"), t("propertyNew.stepTimes")];

  const reset = () => {
    setStep(0);
    setName("");
    setAddressLine("");
    setPostalCode("");
    setCity("");
    setArea("");
    setErrors({});
    setDuration(null);
  };

  const validateStep = () => {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!name.trim()) e.name = t("form.required");
      if (!city.trim()) e.city = t("form.required");
    }
    if (step === 1 && bedCount === 0) e.beds = t("propertyNew.atLeastOneBed");
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const create = () => {
    const bedList = BED_SIZES.flatMap((size) => Array.from({ length: beds[size] }, () => ({ id: newId("bed"), size })));
    const id = addProperty({
      name: name.trim(),
      addressLine: addressLine.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
      city: city.trim(),
      area: area.trim() || undefined,
      countryCode,
      timezone,
      capacity,
      beds: bedList,
      defaultCheckIn: checkIn,
      defaultCheckOut: checkOut,
      cleaningDurationMin: duration ?? suggested,
      checkInService,
      checkOutService,
      access: { type: "key_box" },
      checklist: buildChecklist(suggestedTemplate(bedList), locale),
    });
    onOpenChange(false);
    reset();
    router.push(`/properties/${id}`);
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <SheetContent title={t("propertyNew.title")} description={steps[step]} closeLabel={t("common.close")}>
        {/* Progression */}
        <ol className="mb-6 flex gap-1.5" aria-label={t("propertyNew.progress", { step: step + 1, total: 3 })}>
          {steps.map((s, i) => (
            <li key={s} className={cn("h-1 flex-1 rounded-full", i <= step ? "bg-accent" : "bg-line")} />
          ))}
        </ol>

        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!validateStep()) return;
            if (step < 2) setStep(step + 1);
            else create();
          }}
          className="space-y-4"
        >
          {step === 0 && (
            <>
              <Field label={t("property.name")} htmlFor="p-name" error={errors.name} hint={t("propertyNew.nameHint")}>
                <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Loft Marais" />
              </Field>
              <Field label={t("property.address")} htmlFor="p-address">
                <Input id="p-address" value={addressLine} onChange={(e) => setAddressLine(e.target.value)} autoComplete="street-address" />
              </Field>
              <div className="grid grid-cols-[120px_1fr] gap-3">
                <Field label={t("property.postalCode")} htmlFor="p-postal">
                  <Input id="p-postal" value={postalCode} onChange={(e) => setPostalCode(e.target.value)} autoComplete="postal-code" />
                </Field>
                <Field label={t("property.city")} htmlFor="p-city" error={errors.city}>
                  <Input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} autoComplete="address-level2" />
                </Field>
              </div>
              <Field label={t("property.area")} htmlFor="p-area" hint={t("property.areaHint")}>
                <Input id="p-area" value={area} onChange={(e) => setArea(e.target.value)} />
              </Field>
              <Field label={t("property.country")} htmlFor="p-country">
                <Select
                  id="p-country"
                  value={countryCode}
                  onChange={(e) => {
                    setCountryCode(e.target.value);
                    if (COUNTRY_TZ[e.target.value]) setTimezone(COUNTRY_TZ[e.target.value]);
                  }}
                >
                  {sortedCountries(locale).map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("property.timezone")} htmlFor="p-tz" hint={t("property.timezoneHint")}>
                <Select id="p-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
                  {allTimezones().map((tz) => (
                    <option key={tz} value={tz}>
                      {timezoneLabel(tz, locale)}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          )}

          {step === 1 && (
            <>
              <ul className="divide-y divide-line rounded-lg border border-line">
                {BED_SIZES.map((size) => (
                  <li key={size} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="text-[15px]">{t(`bed.${size}`)}</span>
                    <Stepper label={t(`bed.${size}`)} value={beds[size]} onChange={(v) => setBeds({ ...beds, [size]: v })} />
                  </li>
                ))}
              </ul>
              {errors.beds && (
                <p role="alert" className="text-caption text-danger">
                  {errors.beds}
                </p>
              )}
              <div className="flex items-center justify-between gap-3 rounded-lg border border-line px-4 py-2.5">
                <span className="text-[15px]">{t("property.capacity")}</span>
                <Stepper label={t("property.capacity")} value={capacity} onChange={setCapacity} min={1} max={30} />
              </div>
              <p className="text-caption text-muted">{t("propertyNew.checklistHint")}</p>
            </>
          )}

          {step === 2 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Field label={t("property.checkIn")} htmlFor="p-in">
                  <Input id="p-in" type="time" step={900} value={checkIn} onChange={(e) => setCheckIn(e.target.value)} />
                </Field>
                <Field label={t("property.checkOut")} htmlFor="p-out">
                  <Input id="p-out" type="time" step={900} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} />
                </Field>
              </div>
              <Field label={t("property.cleaningDuration")} htmlFor="p-dur" hint={t("propertyNew.durationHint", { minutes: suggested })}>
                <Select id="p-dur" value={duration ?? suggested} onChange={(e) => setDuration(Number(e.target.value))}>
                  {Array.from({ length: 24 }, (_, i) => (i + 2) * 15).map((m) => (
                    <option key={m} value={m}>
                      {t("time.duration", { hours: Math.floor(m / 60), minutes: m % 60 })}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="divide-y divide-line">
                <SwitchRow id="p-cis" label={t("property.checkInService")} description={t("property.checkInServiceHint")} checked={checkInService} onCheckedChange={setCheckInService} />
                <SwitchRow id="p-cos" label={t("property.checkOutService")} description={t("property.checkOutServiceHint")} checked={checkOutService} onCheckedChange={setCheckOutService} />
              </div>
            </>
          )}

          <div className="flex gap-2 pt-2">
            {step > 0 && (
              <Button type="button" variant="secondary" size="lg" onClick={() => setStep(step - 1)}>
                <ArrowLeft className="rtl:-scale-x-100" />
                {t("auth.back")}
              </Button>
            )}
            <Button type="submit" size="lg" className="flex-1">
              {step < 2 ? (
                <>
                  {t("auth.continue")}
                  <ArrowRight className="rtl:-scale-x-100" />
                </>
              ) : (
                <>
                  <Check />
                  {t("propertyNew.create")}
                </>
              )}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
