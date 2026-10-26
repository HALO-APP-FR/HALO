"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Check } from "lucide-react";
import type { AlertCategory, AlertLocation, AlertSource, Property } from "@/lib/domain/types";
import { isCatalogAmenity } from "@/lib/domain/amenities";
import { useHalo } from "@/lib/store/halo-store";
import { deletePhoto } from "@/lib/store/photos";
import { Button } from "@/components/ui/button";
import { Field, Select, Textarea } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SwitchRow } from "@/components/ui/switch";
import { AddPhotoButton, PhotoThumb } from "./photo-thumb";
import { cn } from "@/lib/utils";

export const ALERT_CATEGORIES: AlertCategory[] = ["breakdown", "damage", "leak", "cleanliness", "missing_item", "pests", "noise", "access", "other"];
const GUEST_CATEGORIES: AlertCategory[] = ["breakdown", "damage", "leak", "cleanliness", "pests", "noise", "access", "other"];
const MISSING_ITEMS = ["towels", "toilet_paper", "bedding", "coffee", "soap", "kitchen", "other"] as const;

/**
 * Signalement d'un problème, localisé (pièce ou équipement du logement), avec photos.
 * Utilisé par l'agent (pendant sa mission), le voyageur (livret) et le manager.
 */
export function ReportSheet({
  open,
  onOpenChange,
  property,
  source,
  mode = "problem",
  reservationId,
  taskId,
  reporterName,
  onSent,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  property: Property;
  source: AlertSource;
  mode?: "problem" | "missing";
  reservationId?: string;
  taskId?: string;
  reporterName?: string;
  onSent?: () => void;
}) {
  if (!open) return null;
  return (
    <ReportSheetInner
      key={mode}
      onOpenChange={onOpenChange}
      property={property}
      source={source}
      mode={mode}
      reservationId={reservationId}
      taskId={taskId}
      reporterName={reporterName}
      onSent={onSent}
    />
  );
}

function ReportSheetInner({
  onOpenChange,
  property,
  source,
  mode,
  reservationId,
  taskId,
  reporterName,
  onSent,
}: {
  onOpenChange: (o: boolean) => void;
  property: Property;
  source: AlertSource;
  mode: "problem" | "missing";
  reservationId?: string;
  taskId?: string;
  reporterName?: string;
  onSent?: () => void;
}) {
  const t = useTranslations();
  const [category, setCategory] = useState<AlertCategory | null>(mode === "missing" ? "missing_item" : null);
  const [where, setWhere] = useState("");
  const [items, setItems] = useState<string[]>([]);
  const [description, setDescription] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [name, setName] = useState(reporterName ?? "");
  const [error, setError] = useState<string | null>(null);
  const categories = source === "guest" ? GUEST_CATEGORIES : ALERT_CATEGORIES;

  const locationOf = (value: string): AlertLocation | undefined => {
    if (!value) return undefined;
    const [kind, ref] = value.split(":") as ["room" | "amenity" | "custom" | "other", string];
    if (kind === "room") return { kind: "room", ref, label: property.checklist.find((r) => r.id === ref)?.name ?? ref };
    if (kind === "amenity") return { kind: "amenity", ref, label: isCatalogAmenity(ref) ? t(`amenity.${ref}`) : ref };
    if (kind === "custom") return { kind: "amenity", ref, label: ref };
    return { kind: "other", label: t("alerts.elsewhere") };
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "problem" && !category) {
      setError(t("alerts.chooseCategory"));
      return;
    }
    if (mode === "missing" && items.length === 0 && !description.trim()) {
      setError(t("alerts.chooseItems"));
      return;
    }
    if (mode === "problem" && !description.trim() && photos.length === 0) {
      setError(t("alerts.describe"));
      return;
    }
    const text =
      mode === "missing"
        ? [items.map((i) => t(`alerts.item_${i}`)).join(", "), description.trim()].filter(Boolean).join(" — ")
        : description.trim();
    useHalo.getState().addAlert({
      propertyId: property.id,
      reservationId,
      taskId,
      source,
      reporterName: name.trim() || undefined,
      category: category ?? "other",
      location: locationOf(where),
      description: text,
      urgent,
      photoIds: photos,
    });
    toast(source === "guest" ? t("alerts.sentGuest") : t("alerts.sent"));
    onSent?.();
    onOpenChange(false);
  };

  const close = (o: boolean) => {
    if (!o) photos.forEach((p) => void deletePhoto(p));
    onOpenChange(o);
  };

  return (
    <Sheet open onOpenChange={close}>
      <SheetContent
        title={mode === "missing" ? t("alerts.missingTitle") : t("alerts.reportTitle")}
        description={mode === "missing" ? t("alerts.missingHint") : t("alerts.reportHint")}
        closeLabel={t("common.close")}
      >
        <form onSubmit={submit} noValidate className="space-y-5 pt-2">
          {mode === "problem" ? (
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-muted">{t("alerts.what")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {categories.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={category === c}
                    onClick={() => setCategory(c)}
                    className={cn(
                      "flex min-h-12 items-center gap-2 rounded-lg border px-3 text-start text-[15px] font-medium transition-colors",
                      category === c ? "border-accent bg-accent-soft text-accent-text" : "border-line hover:bg-surface-hover",
                    )}
                  >
                    {category === c && <Check className="size-4 shrink-0" />}
                    {t(`alertCategory.${c}`)}
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium text-muted">{t("alerts.whatMissing")}</legend>
              <div className="flex flex-wrap gap-2">
                {MISSING_ITEMS.map((i) => {
                  const on = items.includes(i);
                  return (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setItems(on ? items.filter((x) => x !== i) : [...items, i])}
                      className={cn(
                        "inline-flex h-11 items-center gap-1.5 rounded-full border px-4 text-[15px] font-medium",
                        on ? "border-accent bg-accent-soft text-accent-text" : "border-line hover:bg-surface-hover",
                      )}
                    >
                      {on && <Check className="size-4" />}
                      {t(`alerts.item_${i}`)}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}

          {mode === "problem" && (
            <Field label={t("alerts.where")} htmlFor="r-where" hint={t("alerts.whereHint")}>
              <Select id="r-where" value={where} onChange={(e) => setWhere(e.target.value)} className="h-12 text-[16px]">
                <option value="">{t("alerts.whereUnknown")}</option>
                {property.checklist.length > 0 && (
                  <optgroup label={t("alerts.rooms")}>
                    {property.checklist.map((r) => (
                      <option key={r.id} value={`room:${r.id}`}>
                        {r.name}
                      </option>
                    ))}
                  </optgroup>
                )}
                {property.amenities.length + property.customAmenities.length > 0 && (
                  <optgroup label={t("alerts.equipment")}>
                    {property.amenities.map((a) => (
                      <option key={a} value={`amenity:${a}`}>
                        {t(`amenity.${a}`)}
                      </option>
                    ))}
                    {property.customAmenities.map((a) => (
                      <option key={a} value={`custom:${a}`}>
                        {a}
                      </option>
                    ))}
                  </optgroup>
                )}
                <option value="other:">{t("alerts.elsewhere")}</option>
              </Select>
            </Field>
          )}

          <Field label={mode === "missing" ? t("alerts.detailsOptional") : t("alerts.details")} htmlFor="r-desc">
            <Textarea id="r-desc" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("alerts.detailsPlaceholder")} />
          </Field>

          {mode === "problem" && (
            <div>
              <span className="mb-2 block text-[13px] font-medium text-muted">{t("alerts.photos")}</span>
              <div className="flex flex-wrap gap-2">
                {photos.map((p) => (
                  <PhotoThumb
                    key={p}
                    id={p}
                    onRemove={() => {
                      void deletePhoto(p);
                      setPhotos(photos.filter((x) => x !== p));
                    }}
                  />
                ))}
                <AddPhotoButton onAdded={(id) => setPhotos((list) => [...list, id])} label={t("alerts.addPhoto")} />
              </div>
            </div>
          )}

          {source !== "manager" && (
            <Field label={t("alerts.yourName")} htmlFor="r-name">
              <Input id="r-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="given-name" />
            </Field>
          )}

          {mode === "problem" && (
            <SwitchRow id="r-urgent" label={t("alerts.urgent")} description={t("alerts.urgentHint")} checked={urgent} onCheckedChange={setUrgent} />
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-danger-soft p-3 text-[14px] text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="xl" variant={urgent ? "danger" : "primary"}>
            {t("alerts.send")}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}
