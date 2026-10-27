"use client";

import { useTranslations } from "next-intl";
import { ChevronDown, Navigation } from "lucide-react";
import type { Property } from "@/lib/domain/types";
import { destinationQuery, directionsLink, MAPS_APPS, type MapsApp } from "@/lib/engine/directions";
import { useHalo } from "@/lib/store/halo-store";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const open = (url: string) => {
  window.open(url, "_blank", "noopener,noreferrer");
};

/**
 * Bouton « Itinéraire » : ouvre l'application par défaut de la personne,
 * ou propose Apple Plans / Google Maps / Waze. Aucune localisation demandée.
 */
export function DirectionsButton({
  property,
  label = true,
  className,
  size = "xl",
}: {
  property: Property;
  label?: boolean;
  className?: string;
  size?: "xl" | "lg" | "md";
}) {
  const t = useTranslations();
  const preferred = useHalo((s) => s.mapsApp);
  const q = destinationQuery(property);
  const text = label ? t("task.directions") : undefined;

  const menu = (
    <DropdownMenuContent align="end" className="min-w-56">
      <DropdownMenuLabel>{t("directions.openWith")}</DropdownMenuLabel>
      {MAPS_APPS.map((app) => (
        <DropdownMenuItem key={app} onSelect={() => open(directionsLink(app, property))}>
          <Navigation />
          <span className="flex-1">{t(`directions.app.${app}`)}</span>
          {app === preferred && <span className="text-caption text-muted">{t("directions.default")}</span>}
        </DropdownMenuItem>
      ))}
      {!q.precise && (
        <>
          <DropdownMenuSeparator />
          <p className="max-w-64 px-2.5 py-1.5 text-caption text-warning">{t("directions.approximate")}</p>
        </>
      )}
    </DropdownMenuContent>
  );

  if (preferred) {
    // Application par défaut en un geste, les autres restent accessibles
    return (
      <div className={cn("flex shrink-0 items-stretch gap-px", className)}>
        <Button asChild size={size} variant="secondary" className="w-auto flex-1 rounded-e-none bg-surface px-4 shadow-card hover:bg-surface-hover">
          <a href={directionsLink(preferred, property)} target="_blank" rel="noreferrer" aria-label={label ? undefined : t("directions.openIn", { app: t(`directions.app.${preferred}`) })}>
            <Navigation />
            {text}
          </a>
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size={size} variant="secondary" className="w-10 flex-none rounded-s-none bg-surface px-0 shadow-card hover:bg-surface-hover" aria-label={t("directions.other")}>
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          {menu}
        </DropdownMenu>
      </div>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size={size} variant="secondary" className={cn("w-auto bg-surface px-4 shadow-card hover:bg-surface-hover", className)} aria-label={label ? undefined : t("task.directions")}>
          <Navigation />
          {text}
        </Button>
      </DropdownMenuTrigger>
      {menu}
    </DropdownMenu>
  );
}

/** Réglage : application ouverte par défaut (ou demander à chaque fois). */
export function MapsAppSelect({ id = "maps-app", className }: { id?: string; className?: string }) {
  const t = useTranslations();
  const value = useHalo((s) => s.mapsApp);
  return (
    <Select
      id={id}
      value={value ?? ""}
      onChange={(e) => useHalo.getState().setMapsApp((e.target.value || undefined) as MapsApp | undefined)}
      className={className}
    >
      <option value="">{t("directions.ask")}</option>
      {MAPS_APPS.map((app) => (
        <option key={app} value={app}>
          {t(`directions.app.${app}`)}
        </option>
      ))}
    </Select>
  );
}
