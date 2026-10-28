"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { createProperty, updateGuide } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useRun } from "./use-run";

export function PropertyCreateForm() {
  const t = useTranslations("connected.properties");
  const router = useRouter();
  const { pending, error, run } = useRun();
  const [f, setF] = useState({ name: "", address_line: "", postal_code: "", city: "", cleaning_duration_min: 90, default_check_in: "16:00", default_check_out: "11:00" });
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">{t("new")}</h2>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          run(() => createProperty({ ...f, timezone: "Europe/Paris" }), (d) => router.push(`/app/properties/${d.id}`));
        }}
      >
        <Field label={t("name")} htmlFor="pr-name" className="sm:col-span-2">
          <Input id="pr-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label={t("address")} htmlFor="pr-addr" className="sm:col-span-2">
          <Input id="pr-addr" value={f.address_line} onChange={(e) => setF({ ...f, address_line: e.target.value })} />
        </Field>
        <Field label={t("postalCode")} htmlFor="pr-zip">
          <Input id="pr-zip" value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} />
        </Field>
        <Field label={t("city")} htmlFor="pr-city">
          <Input id="pr-city" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </Field>
        <Field label={t("checkIn")} htmlFor="pr-in">
          <Input id="pr-in" type="time" value={f.default_check_in} onChange={(e) => setF({ ...f, default_check_in: e.target.value })} />
        </Field>
        <Field label={t("checkOut")} htmlFor="pr-out">
          <Input id="pr-out" type="time" value={f.default_check_out} onChange={(e) => setF({ ...f, default_check_out: e.target.value })} />
        </Field>
        <Field label={t("cleaningDuration")} htmlFor="pr-dur">
          <Input id="pr-dur" type="number" min={5} max={1440} value={f.cleaning_duration_min} onChange={(e) => setF({ ...f, cleaning_duration_min: Number(e.target.value) })} />
        </Field>
        <div className="flex items-end sm:col-span-2">
          {error && <p role="alert" className="me-auto text-[14px] text-danger">{error}</p>}
          <Button type="submit" className="ms-auto" disabled={pending || !f.name.trim()} data-testid="property-create">
            {t("create")}
          </Button>
        </div>
      </form>
    </Card>
  );
}

const GUIDE_FIELDS = ["welcome", "house_rules", "checkout_instructions", "wifi_name", "wifi_password", "parking", "trash", "emergency_phone", "recommendations"] as const;
type Guide = Partial<Record<(typeof GUIDE_FIELDS)[number], string | null>> & { enabled?: boolean };

export function GuideEditor({ propertyId, guide }: { propertyId: string; guide: Guide }) {
  const t = useTranslations("connected.guide");
  const { pending, error, run } = useRun();
  const [g, setG] = useState<Guide>(guide);
  const [saved, setSaved] = useState(false);
  const long = new Set(["welcome", "house_rules", "checkout_instructions", "recommendations", "parking", "trash"]);
  return (
    <Card className="p-5">
      <h2 className="text-[17px] font-semibold">{t("title")}</h2>
      <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      <form
        className="mt-4 grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          run(() => updateGuide(propertyId, { ...Object.fromEntries(GUIDE_FIELDS.map((k) => [k, g[k]?.trim() || null])), enabled: g.enabled ?? true }), () => setSaved(true));
        }}
      >
        {GUIDE_FIELDS.map((k) => (
          <Field key={k} label={t(`fields.${k}`)} htmlFor={`g-${k}`} className={long.has(k) ? "sm:col-span-2" : undefined}>
            {long.has(k) ? (
              <Textarea id={`g-${k}`} value={g[k] ?? ""} onChange={(e) => setG({ ...g, [k]: e.target.value })} />
            ) : (
              <Input id={`g-${k}`} value={g[k] ?? ""} onChange={(e) => setG({ ...g, [k]: e.target.value })} />
            )}
          </Field>
        ))}
        <p className="text-[13px] text-muted sm:col-span-2">{t("noAccessCodes")}</p>
        <div className="flex items-center gap-3 sm:col-span-2">
          {error && <p role="alert" className="text-[14px] text-danger">{error}</p>}
          {saved && !error && <p role="status" className="text-[14px] text-success">{t("saved")}</p>}
          <Button type="submit" className="ms-auto" disabled={pending} data-testid="guide-save">
            {t("save")}
          </Button>
        </div>
      </form>
    </Card>
  );
}
