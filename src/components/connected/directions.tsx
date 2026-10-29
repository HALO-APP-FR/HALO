"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown, Navigation } from "lucide-react";
import { destinationQuery, directionsLink, MAPS_APPS, type Destination, type MapsApp } from "@/lib/engine/directions";
import { updateMapsApp } from "@/lib/connected/actions";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useRun } from "./use-run";

/**
 * « Itinéraire » vers le logement de la mission : l'application par défaut de l'agent en un geste,
 * les deux autres au choix. Rien n'est envoyé avant le geste de l'agent ; liens web universels
 * (ils ouvrent l'application si elle est installée, sinon la version web).
 */
export function MissionDirections({ destination, preferred }: { destination: Destination; preferred: MapsApp | null }) {
  const t = useTranslations();
  const q = destinationQuery(destination);
  const go = (app: MapsApp) => window.open(directionsLink(app, destination), "_blank", "noopener,noreferrer");
  const others = MAPS_APPS.filter((a) => a !== preferred);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="directions">
      {preferred && (
        <Button size="lg" onClick={() => go(preferred)} data-testid={`directions-${preferred}`} data-default="1">
          <Navigation />
          {t("directions.openIn", { app: t(`directions.app.${preferred}`) })}
        </Button>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="lg" variant={preferred ? "outline" : "primary"} data-testid="directions-menu">
            {!preferred && <Navigation />}
            {preferred ? t("directions.other") : t("task.directions")}
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>{t("directions.openWith")}</DropdownMenuLabel>
          {(preferred ? others : MAPS_APPS).map((app) => (
            <DropdownMenuItem key={app} onSelect={() => go(app)} data-testid={`directions-${app}`}>
              <Navigation />
              {t(`directions.app.${app}`)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {!q.precise && <p className="basis-full text-[13px] text-warning">{t("directions.approximate")}</p>}
    </div>
  );
}

/** Application d'itinéraire par défaut (enregistrée dans le profil, conservée après reconnexion). */
export function MapsAppSetting({ value }: { value: MapsApp | null }) {
  const t = useTranslations();
  const { pending, error, run } = useRun();
  const [v, setV] = useState(value ?? "");
  return (
    <div>
      <Select
        id="maps-app"
        value={v}
        disabled={pending}
        onChange={(e) => {
          setV(e.target.value);
          run(() => updateMapsApp((e.target.value || null) as MapsApp | null));
        }}
        data-testid="maps-app"
      >
        <option value="">{t("directions.ask")}</option>
        {MAPS_APPS.map((app) => (
          <option key={app} value={app}>
            {t(`directions.app.${app}`)}
          </option>
        ))}
      </Select>
      {error && <p role="alert" className="mt-1 text-[13px] text-danger">{error}</p>}
    </div>
  );
}
