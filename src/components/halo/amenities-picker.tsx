"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, Plus, X } from "lucide-react";
import { AMENITY_GROUPS } from "@/lib/domain/amenities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmenityIcon } from "./amenity-icon";
import { cn } from "@/lib/utils";

/** Sélection des équipements par familles (puces à cocher, grosses zones tactiles) + ajouts libres. */
export function AmenitiesPicker({
  value,
  custom,
  onChange,
  onCustomChange,
}: {
  value: string[];
  custom: string[];
  onChange: (v: string[]) => void;
  onCustomChange: (v: string[]) => void;
}) {
  const t = useTranslations();
  const [draft, setDraft] = useState("");
  const toggle = (key: string) => onChange(value.includes(key) ? value.filter((k) => k !== key) : [...value, key]);

  return (
    <div className="space-y-5">
      {AMENITY_GROUPS.map(({ group, keys }) => (
        <fieldset key={group}>
          <legend className="mb-2 text-micro text-muted">{t(`amenityGroup.${group}`)}</legend>
          <div className="flex flex-wrap gap-2">
            {keys.map((key) => {
              const on = value.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(key)}
                  className={cn(
                    "inline-flex h-10 items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition-colors",
                    on ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface text-fg hover:bg-surface-hover",
                  )}
                >
                  {on ? <Check className="size-4" strokeWidth={2.4} /> : <AmenityIcon amenity={key} className="size-4 text-muted" />}
                  {t(`amenity.${key}`)}
                </button>
              );
            })}
          </div>
        </fieldset>
      ))}

      <fieldset>
        <legend className="mb-2 text-micro text-muted">{t("amenities.custom")}</legend>
        {custom.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {custom.map((c) => (
              <span key={c} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-accent bg-accent-soft pe-1.5 ps-3.5 text-[14px] font-medium text-accent-text">
                {c}
                <button
                  type="button"
                  onClick={() => onCustomChange(custom.filter((x) => x !== c))}
                  className="grid size-7 place-items-center rounded-full hover:bg-accent/10"
                  aria-label={t("form.remove")}
                >
                  <X className="size-4" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("amenities.customPlaceholder")}
            aria-label={t("amenities.custom")}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                const v = draft.trim();
                if (v && !custom.includes(v)) onCustomChange([...custom, v]);
                setDraft("");
              }
            }}
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            className="size-10 shrink-0"
            aria-label={t("amenities.addCustom")}
            onClick={() => {
              const v = draft.trim();
              if (v && !custom.includes(v)) onCustomChange([...custom, v]);
              setDraft("");
            }}
          >
            <Plus />
          </Button>
        </div>
      </fieldset>
    </div>
  );
}
