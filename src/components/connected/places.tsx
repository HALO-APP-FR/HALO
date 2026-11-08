"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { ChevronDown, Clock, Globe, Heart, MapPin, Navigation, Phone } from "lucide-react";
import { guestFavorite } from "@/lib/connected/guest-actions";
import { addPlace, deletePlace, importNearbyPlaces, locateProperty, setAutoPlaces, setPlaceHidden, storeImportedPlaces, updatePlace, verifyPlace, type PlaceInput } from "@/lib/connected/actions";
import { directionsLink, MAPS_APPS, type MapsApp } from "@/lib/engine/directions";
import { beforeAccess, revealsHome, streetOf } from "@/lib/engine/privacy";
import { GUEST_FILTERS, GUEST_RADII, matchesFilter, overpassQuery, parseOverpass, parsePhoton, photonUrls, PLACE_CATEGORIES, withinRadius, type GuestFilter, type PlaceCategory } from "@/lib/engine/places";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

export interface Place {
  id: string;
  source: "manager" | "owner" | "openstreetmap";
  category: PlaceCategory;
  /** Type précis (restaurant, cafe, pharmacy…) quand la source le fournit */
  kind?: string | null;
  name: string;
  description?: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours: string | null;
  phone: string | null;
  website: string | null;
  note: string | null;
  updated_at: string;
  distance_m: number | null;
  /** Avant l'ouverture des informations pratiques : tranche de distance (1 = moins de 1 km, 2 = 1 à 2 km, 3 = 2 à 3 km) */
  distance_band?: number | null;
  hidden?: boolean;
  created_at?: string | null;
  verified_at?: string | null;
  /** Avant l'ouverture : « booking » (dès la réservation) ou « access » (à l'ouverture). Absent tant que la migration 27 n'est pas appliquée. */
  guest_visibility?: "booking" | "access" | null;
}

/**
 * Carte OpenStreetMap (Leaflet) : le logement et les lieux affichés. Tuiles et attribution OpenStreetMap.
 * Si les tuiles ne chargent pas (réseau), la liste reste complète et utilisable.
 * Toucher un marqueur ouvre la fiche du lieu dans la liste.
 */
function PlacesMap({ center, places, selected, onSelect, onTilesFailed, homeLabel, zoneRadius }: { center: { lat: number; lng: number }; places: Place[]; selected?: string | null; onSelect?: (id: string) => void; onTilesFailed: () => void; homeLabel?: string; /** Avant l'ouverture : zone approximative (aucun point de logement) */ zoneRadius?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
  const select = useRef(onSelect);
  useEffect(() => {
    select.current = onSelect;
  });
  useEffect(() => {
    let alive = true;
    void import("leaflet").then((mod) => alive && setL(mod.default ?? mod));
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!L || !el.current || map.current) return;
    map.current = L.map(el.current, { scrollWheelZoom: false, attributionControl: true }).setView([center.lat, center.lng], 15);
    let failed = false;
    const fail = () => {
      if (!failed) {
        failed = true;
        onTilesFailed();
      }
    };
    // Le serveur de tuiles peut répondre par une IMAGE « 403 Access blocked » (refus d'usage) : le navigateur
    // l'affiche comme une tuile normale, sans erreur. On vérifie donc une tuile réelle avant de faire confiance au fond.
    const z = 15;
    const tx = Math.floor(((center.lng + 180) / 360) * 2 ** z);
    const ty = Math.floor(((1 - Math.log(Math.tan((center.lat * Math.PI) / 180) + 1 / Math.cos((center.lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
    fetch(`https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`, { referrerPolicy: "strict-origin-when-cross-origin", cache: "force-cache" })
      .then((r) => {
        if (!r.ok || !(r.headers.get("content-type") ?? "image/png").startsWith("image/")) fail();
      })
      .catch(() => fail());
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      // Le fournisseur exige l'origine du site (sans elle : tuiles « Access blocked »)
      referrerPolicy: "strict-origin-when-cross-origin",
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    })
      // Fond de carte indisponible (hors connexion, service saturé) : on le dit, la liste reste utilisable
      .on("tileerror", fail)
      .addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- la carte est créée une seule fois
  }, [L, center.lat, center.lng]);
  useEffect(() => {
    if (!L || !layer.current || !map.current) return;
    layer.current.clearLayers();
    const dot = (color: string, size: number, ring = false) =>
      L.divIcon({ className: "", html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:${ring ? 3 : 2}px solid #fff;box-shadow:0 1px ${ring ? 6 : 3}px rgba(0,0,0,.45)"></span>`, iconSize: [size, size] });
    // Zone approximative : un cercle (jamais de point « logement ») ; sinon le logement
    if (zoneRadius) L.circle([center.lat, center.lng], { radius: zoneRadius, color: "#0055FF", weight: 1.5, dashArray: "6 6", fillOpacity: 0.06, interactive: false }).addTo(layer.current);
    else L.marker([center.lat, center.lng], { icon: dot("#0055FF", 20), zIndexOffset: 1000, title: homeLabel }).bindTooltip(homeLabel ?? "").addTo(layer.current);
    const pts: [number, number][] = [[center.lat, center.lng]];
    for (const p of places) {
      if (p.lat == null || p.lng == null) continue;
      const on = p.id === selected;
      L.marker([p.lat, p.lng], { icon: dot(p.source === "openstreetmap" ? "#334155" : "#d97706", on ? 18 : 12, on), title: p.name, keyboard: true, zIndexOffset: on ? 900 : 0 })
        .bindTooltip(p.name)
        .on("click", () => select.current?.(p.id))
        .addTo(layer.current);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length > 1 && !selected) map.current.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 });
  }, [L, places, center.lat, center.lng, selected, homeLabel, zoneRadius]);
  return <div ref={el} className="h-72 w-full overflow-hidden rounded-xl border border-line bg-subtle md:h-96" data-testid="places-map" role="region" aria-label="Carte" />;
}

/** Distance volontairement arrondie (à vol d'oiseau depuis le logement) : jamais une fausse précision. */
export const fmtDistance = (m: number) => (m < 100 ? "< 100 m" : m < 1000 ? `≈ ${Math.round(m / 50) * 50} m` : `≈ ${(Math.round(m / 100) / 10).toFixed(1).replace(".", ",")} km`);

/** Types de lieux pour lesquels HALO ne doit jamais laisser croire à une ouverture ou une prise en charge d'urgence. */
const HEALTH_KINDS = ["pharmacy", "hospital", "clinic", "doctors"];

/**
 * « Découvrir les alentours » (voyageur) : organisé autour de l'ADRESSE DU LOGEMENT (aucune position demandée).
 * Carte ou liste, envies (restaurants, cafés, courses, pharmacies…), rayon, fiche lieu dépliable, favoris du séjour.
 * Pour chaque lieu : origine (équipe, propriétaire ou proposé automatiquement), distance arrondie, adresse,
 * horaires seulement si la source les fournit, itinéraire Plans / Google Maps / Waze.
 */
export function GuestAround({
  property,
  places,
  hiddenUntil,
  nearHidden = 0,
  autoHidden = 0,
  token,
  favorites: initialFavorites = [],
  favoritesAvailable = false,
  zone = null,
}: {
  property: { name: string; lat: number | null; lng: number | null; address: string };
  /** Avant l'ouverture : centre de la zone approximative (jamais le logement) et état de préparation des lieux */
  zone?: { lat: number; lng: number; radius_m: number; ready: boolean } | null;
  places: Place[];
  /** Lieux très proches retenus jusqu'à l'ouverture (seul leur nombre est connu) */ nearHidden?: number;
  /** Suggestions automatiques retenues jusqu'à l'ouverture */ autoHidden?: number;
  /** Avant la fenêtre habituelle : carte et adresse volontairement masquées jusqu'à cette date */ hiddenUntil?: string;
  /** Lien du séjour : les favoris sont enregistrés avec lui (et suivent ses règles d'expiration) */ token?: string;
  favorites?: string[];
  favoritesAvailable?: boolean;
}) {
  const t = useTranslations("guestSpace.around");
  const tc = useTranslations("places.category");
  const f = useFormatter();
  const center = property.lat != null && property.lng != null ? { lat: property.lat, lng: property.lng } : zone ? { lat: zone.lat, lng: zone.lng } : null;
  const isZone = property.lat == null && Boolean(zone);
  const [view, setView] = useState<"map" | "list">(center ? "map" : "list");
  const [filter, setFilter] = useState<GuestFilter | "all" | "favorites">("all");
  const [radius, setRadius] = useState<number | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [favs, setFavs] = useState<string[]>(initialFavorites);
  const [favError, setFavError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const AUTO_LIMIT = 12;
  const hasDistances = places.some((p) => p.distance_m != null || p.distance_band != null);
  // Sélection de l'équipe et du propriétaire d'abord ; suggestions automatiques ensuite, les plus proches en premier,
  // limitées tant que le voyageur ne demande pas à tout voir (la quantité ne fait pas la pertinence)
  const ordered = useMemo(() => {
    const keep = places.filter((p) => (filter === "favorites" ? favs.includes(p.id) : matchesFilter(p, filter)) && withinRadius(p, radius));
    const picks = keep.filter((p) => p.source !== "openstreetmap");
    const auto = keep.filter((p) => p.source === "openstreetmap").sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
    return { picks, auto };
  }, [places, filter, radius, favs]);
  const autoShown = showAll ? ordered.auto : ordered.auto.slice(0, AUTO_LIMIT);
  const shown = useMemo(() => [...ordered.picks, ...autoShown], [ordered.picks, autoShown]);
  const counts = useMemo(() => Object.fromEntries(GUEST_FILTERS.map((x) => [x.key, places.filter((p) => matchesFilter(p, x.key) && withinRadius(p, radius)).length])), [places, radius]);
  const latestOsm = places.filter((p) => p.source === "openstreetmap").map((p) => p.updated_at).sort().at(-1);
  const sourceLabel = (s: Place["source"]) => (s === "manager" ? t("byTeam") : s === "owner" ? t("byOwner") : t("byOsm"));
  const healthShown = shown.some((p) => p.kind && HEALTH_KINDS.includes(p.kind)) || filter === "pharmacies";
  const pick = (id: string) => {
    setSelected(id);
    requestAnimationFrame(() => {
      const card = document.getElementById(`place-${id}`);
      if (card instanceof HTMLDetailsElement) card.open = true;
      card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
  };
  const toggleFav = async (id: string) => {
    if (!token) return;
    const on = !favs.includes(id);
    setFavError(null);
    setFavs((x) => (on ? [...x, id] : x.filter((y) => y !== id))); // affichage immédiat, annulé si le serveur refuse
    try {
      const r = await guestFavorite(token, id, on);
      if (!r.ok) throw new Error(r.error);
    } catch (e) {
      setFavs((x) => (on ? x.filter((y) => y !== id) : [...x, id]));
      setFavError(typeof navigator !== "undefined" && !navigator.onLine ? t("favOffline") : (e as Error).message === "unavailable" ? t("favUnavailable") : t("favError"));
    }
  };
  const chip = (active: boolean) => cn("h-9 shrink-0 rounded-full border px-3.5 text-[14px] font-medium transition-colors", active ? "border-fg bg-fg text-canvas" : "border-line bg-surface text-fg hover:bg-surface-hover");
  return (
    <section id="alentours" className="scroll-mt-4 space-y-3" data-testid="guest-around">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-title-3">{t("discover")}</h2>
          <p className="text-[14px] text-muted" data-testid="around-origin">
            {isZone ? t("originZone", { date: hiddenUntil ?? "" }) : center ? t("originHome", { address: property.address || property.name }) : hiddenUntil ? t("mapLater", { date: hiddenUntil }) : t("noCoordinates")}
          </p>
        </div>
        {center && places.length > 0 && (
          <div className="inline-flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label={t("viewLabel")} data-testid="around-view">
            {(["map", "list"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("h-8 rounded-full px-3.5 text-[13px] font-medium", view === v ? "bg-fg text-canvas" : "text-muted")} data-testid={`around-view-${v}`}>
                {t(`view.${v}`)}
              </button>
            ))}
          </div>
        )}
      </div>
      {places.length === 0 && nearHidden === 0 && autoHidden === 0 ? (
        <Card className="p-5 text-[15px] text-muted" data-testid="around-empty">
          {isZone && !zone!.ready ? t("zonePreparing") : t("empty")}
        </Card>
      ) : (
        <>
          {hiddenUntil && autoHidden > 0 && (
            <p className="text-[13px] text-muted" data-testid="around-auto-hidden">
              {t("autoHidden", { count: autoHidden, date: hiddenUntil })}
            </p>
          )}
          {hiddenUntil && nearHidden > 0 && (
            <p className="text-[13px] text-muted" data-testid="around-near-hidden">
              {t("nearHidden", { count: nearHidden, date: hiddenUntil })}
            </p>
          )}
          {/* Envies */}
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="toolbar" aria-label={t("filtersLabel")}>
            <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={chip(filter === "all")} data-testid="around-filter-all">
              {t("all")}
            </button>
            {GUEST_FILTERS.filter((x) => counts[x.key] > 0 || filter === x.key).map((x) => (
              <button key={x.key} type="button" aria-pressed={filter === x.key} onClick={() => setFilter(x.key)} className={chip(filter === x.key)} data-testid={`around-filter-${x.key}`}>
                {t(`filter.${x.key}`)}
                <span className="ms-1 opacity-60">{counts[x.key]}</span>
              </button>
            ))}
            {favoritesAvailable && (
              <button type="button" aria-pressed={filter === "favorites"} onClick={() => setFilter("favorites")} className={chip(filter === "favorites")} data-testid="around-filter-favorites">
                <Heart className={cn("me-1 inline size-3.5", favs.length > 0 && "fill-current")} />
                {t("favorites")}
                <span className="ms-1 opacity-60">{favs.length}</span>
              </button>
            )}
          </div>
          {/* Rayon autour du logement */}
          {hasDistances && (
            <div className="flex flex-wrap items-center gap-1.5 text-[13px]" role="group" aria-label={t("radiusLabel")} data-testid="around-radius">
              <span className="me-1 text-muted">{t("radiusLabel")}</span>
              {GUEST_RADII.map((r) => (
                <button key={String(r)} type="button" aria-pressed={radius === r} onClick={() => setRadius(r)} className={cn("h-8 rounded-full border px-3 font-medium", radius === r ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface")} data-testid={`around-radius-${r ?? "all"}`}>
                  {r == null ? t("radiusAll") : r < 1000 ? `${r} m` : `${r / 1000} km`}
                </button>
              ))}
            </div>
          )}
          {center && view === "map" && !tilesFailed && <PlacesMap center={center} places={shown} selected={selected} onSelect={pick} onTilesFailed={() => setTilesFailed(true)} homeLabel={property.name} zoneRadius={isZone ? zone!.radius_m : undefined} />}
          {isZone && (
            <p className="text-[12px] text-muted" data-testid="around-zone-note">
              {t("zoneNote")}
              {places.some((p) => p.source !== "openstreetmap" && p.lat == null) && <span data-testid="around-team-listed"> {t("teamListed")}</span>}
            </p>
          )}
          {tilesFailed && view === "map" && (
            // Fond de carte refusé ou inaccessible : pas de carte trompeuse, la liste reste complète
            <div className="rounded-xl border border-line bg-surface p-4 text-[14px]" role="status" data-testid="around-map-offline">
              <p className="font-medium">{t("mapUnavailableTitle")}</p>
              <p className="mt-0.5 text-muted">{t("mapUnavailable")}</p>
            </div>
          )}
          {healthShown && (
            <p className="rounded-lg border border-line bg-surface p-3 text-[13px]" role="note" data-testid="around-health-note">
              {t("healthNote")}
            </p>
          )}
          {favError && (
            <p className="text-[13px] text-danger" role="alert" data-testid="around-fav-error">
              {favError}
            </p>
          )}
          {shown.length === 0 && (
            <Card className="p-5 text-center text-[14px] text-muted" data-testid="around-no-result">
              {filter === "favorites" ? t("noFavorites") : t("noResult")}
              {(filter !== "all" || radius != null) && (
                <button type="button" className="mt-2 block w-full font-medium text-accent-text" onClick={() => (setFilter("all"), setRadius(null))}>
                  {t("resetFilters")}
                </button>
              )}
            </Card>
          )}
          {ordered.picks.length > 0 && ordered.auto.length > 0 && (
            <p className="text-[13px] font-semibold uppercase tracking-wide text-muted" data-testid="around-picks-title">
              {t("picksTitle")}
            </p>
          )}
          <ul className="space-y-2">
            {shown.map((p, idx) => {
              const dest = { name: p.name, addressLine: p.address ?? undefined, lat: p.lat ?? undefined, lng: p.lng ?? undefined };
              const routable = Boolean(p.address) || (p.lat != null && p.lng != null);
              const fav = favs.includes(p.id);
              return (
                <li key={p.id}>
                  {idx === ordered.picks.length && ordered.auto.length > 0 && (
                    <p className="mb-2 mt-4 text-[13px] font-semibold uppercase tracking-wide text-muted" data-testid="around-auto-title">
                      {t("autoTitle")}
                    </p>
                  )}
                  <details
                    id={`place-${p.id}`}
                    className={cn("group rounded-xl border bg-surface shadow-card", selected === p.id ? "border-accent" : "border-line")}
                    data-testid="around-place"
                    data-category={p.category}
                    data-kind={p.kind ?? ""}
                    data-source={p.source}
                    onToggle={(e) => (e.currentTarget as HTMLDetailsElement).open && setSelected(p.id)}
                  >
                    <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-semibold">{p.name}</p>
                        <p className="text-[13px] text-muted">
                          {p.kind && t.has(`kind.${p.kind}`) ? t(`kind.${p.kind}`) : tc(p.category)}
                          {p.distance_m != null && <span data-testid="around-distance"> · {fmtDistance(p.distance_m)}</span>}
                          {p.distance_m == null && p.distance_band != null && <span data-testid="around-distance-band"> · {t("band", { n: p.distance_band })}</span>}
                        </p>
                        <span
                          className={cn("mt-1.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium", p.source === "openstreetmap" ? "bg-subtle text-muted dark:bg-surface-hover" : "bg-warning-soft text-warning")}
                          data-testid="around-source"
                        >
                          {sourceLabel(p.source)}
                        </span>
                      </div>
                      <ChevronDown className="mt-1 size-5 shrink-0 text-muted transition-transform group-open:rotate-180" aria-hidden />
                    </summary>
                    <div className="border-t border-line px-4 pb-4 pt-3" data-testid="around-detail">
                      {p.description && <p className="text-[14px]">{p.description}</p>}
                      {p.note && (
                        <p className="mt-1 text-[14px]">
                          <span className="font-medium">{t("tip")}</span> {p.note}
                        </p>
                      )}
                      <div className="mt-2 space-y-1 text-[14px] text-muted">
                        <p className="flex gap-1.5">
                          <MapPin className="mt-0.5 size-4 shrink-0" />
                          {p.address ?? <span className="text-[13px]">{t("noAddress")}</span>}
                        </p>
                        <p className="flex gap-1.5" data-testid="around-hours">
                          <Clock className="mt-0.5 size-4 shrink-0" />
                          {/* Horaires transmis par la base seulement s'ils sont vérifiés par l'équipe depuis moins de 6 mois ; jamais « ouvert » */}
                          {p.opening_hours && p.verified_at ? (
                            <span>
                              {p.opening_hours} <span className="text-[12px]">({t("hoursVerifiedOn", { date: f.dateTime(new Date(p.verified_at), { dateStyle: "medium" }) })})</span>
                            </span>
                          ) : (
                            <span className="text-[13px]" data-testid="around-hours-unverified">{t("hoursUnverified")}</span>
                          )}
                        </p>
                        {p.phone && (
                          <a href={`tel:${p.phone.replace(/[^+\d]/g, "")}`} className="flex gap-1.5 text-accent-text">
                            <Phone className="mt-0.5 size-4 shrink-0" />
                            {p.phone}
                          </a>
                        )}
                        {p.website && /^https?:\/\//.test(p.website) && (
                          <a href={p.website} target="_blank" rel="noreferrer noopener" className="flex gap-1.5 text-accent-text">
                            <Globe className="mt-0.5 size-4 shrink-0" />
                            {t("website")}
                          </a>
                        )}
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        {routable ? (
                          MAPS_APPS.map((app: MapsApp) => (
                            <a
                              key={app}
                              href={directionsLink(app, dest)}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-[13px] font-medium hover:bg-surface-hover"
                              data-testid={`around-go-${app}`}
                            >
                              <Navigation className="size-3.5" />
                              {t(`app.${app}`)}
                            </a>
                          ))
                        ) : (
                          <p className="text-[12px] text-muted">{t("noRoute")}</p>
                        )}
                        {favoritesAvailable && (
                          <button
                            type="button"
                            aria-pressed={fav}
                            onClick={() => void toggleFav(p.id)}
                            className={cn("ms-auto inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium", fav ? "border-accent bg-accent-soft text-accent-text" : "border-line bg-surface")}
                            data-testid="around-fav"
                          >
                            <Heart className={cn("size-4", fav && "fill-current")} />
                            {fav ? t("favOn") : t("favOff")}
                          </button>
                        )}
                      </div>
                      <p className="mt-2 text-[11px] text-faint">
                        {p.source === "openstreetmap"
                          ? t("osmData", { date: f.dateTime(new Date(p.updated_at), { dateStyle: "medium" }) })
                          : p.verified_at
                            ? t("verifiedOn", { date: f.dateTime(new Date(p.verified_at), { dateStyle: "medium" }) })
                            : t(p.source === "owner" ? "ownerAddedOn" : "addedOn", { date: f.dateTime(new Date(p.created_at ?? p.updated_at), { dateStyle: "medium" }) })}
                      </p>
                    </div>
                  </details>
                </li>
              );
            })}
          </ul>
          {ordered.auto.length > AUTO_LIMIT && (
            <Button variant="outline" size="sm" onClick={() => setShowAll((v) => !v)} data-testid="around-show-all">
              {showAll ? t("showLess") : t("showAll", { count: ordered.auto.length })}
            </Button>
          )}
          <p className="text-[12px] text-faint" data-testid="around-sources">
            {t("distanceNote")}
            {latestOsm && ` · ${t("osmData", { date: f.dateTime(new Date(latestOsm), { dateStyle: "medium" }) })}`}
            {" · "}
            {t("notBookable")}
          </p>
        </>
      )}
    </section>
  );
}

/** Gestion des recommandations (responsable) : localisation, import automatique, recommandations de l'équipe ou du propriétaire. */
export function PlacesManager({
  propertyId,
  coords,
  geoSource,
  autoPlaces,
  places,
  overpassUrls,
  photonUrl,
  homeAddress = null,
  visibilityReady = false,
}: {
  /** Adresse du logement : garde-fou « même rue » (avant l'ouverture) */
  homeAddress?: string | null;
  /** Migration 27 appliquée : choix « dès la réservation » proposé */
  visibilityReady?: boolean;
  overpassUrls: string[];
  /** Photon (OpenStreetMap, sans clé) : solution de repli quand Overpass refuse ou ne répond pas */
  photonUrl: string;
  propertyId: string;
  coords: { lat: number; lng: number } | null;
  geoSource: string | null;
  autoPlaces: boolean;
  places: Place[];
}) {
  const t = useTranslations("connected.places");
  const f = useFormatter();
  const tc = useTranslations("places.category");
  const locate = useRun();
  const imp = useRun();
  const auto = useRun();
  const [manual, setManual] = useState({ lat: coords?.lat?.toString() ?? "", lng: coords?.lng?.toString() ?? "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<Place | null>(null);
  const [autoOn, setAutoOn] = useState(autoPlaces);
  const own = places.filter((p) => p.source !== "openstreetmap");
  /**
   * Import : depuis CE navigateur (le service public Overpass refuse les serveurs d'hébergement, réponse 406),
   * puis enregistrement contrôlé par le serveur. Si le navigateur n'obtient rien, le serveur essaie son propre
   * fournisseur (Geoapify s'il est configuré). Seules les coordonnées du logement sont transmises.
   */
  /**
   * Import lancé depuis le navigateur du responsable (les serveurs d'hébergement sont refusés par Overpass).
   * 1) Overpass (le plus riche : horaires, téléphone), délai court ; 2) Photon (OpenStreetMap, rapide, sans
   * horaires) ; 3) serveur HALO. Les données sont revalidées par le serveur avant enregistrement.
   */
  const importFromBrowser = async () => {
    if (coords) {
      const send = (parsed: ReturnType<typeof parseOverpass>, covered?: string[]) =>
        storeImportedPlaces(
          propertyId,
          parsed.places.map((x) => ({ externalId: x.externalId, category: x.category, name: x.name, address: x.address, lat: x.lat, lng: x.lng, openingHours: x.openingHours, phone: x.phone, website: x.website, kind: x.kind ?? null })),
          parsed.dataDate,
          covered,
        );
      for (const url of overpassUrls) {
        try {
          const res = await fetch(`${url}?data=${encodeURIComponent(overpassQuery(coords.lat, coords.lng))}`, { signal: AbortSignal.timeout(12_000) });
          if (!res.ok) continue;
          const json = await res.json();
          // Réponse tronquée (« runtime error » : délai dépassé côté Overpass) : on passe à la source suivante
          if (typeof json?.remark === "string" && /error/i.test(json.remark)) continue;
          return send(parseOverpass(json, coords.lat, coords.lng));
        } catch {
          // source suivante
        }
      }
      // Photon limite les requêtes simultanées (échec observé sur 1 requête sur 5 en parallèle) :
      // une catégorie à la fois, une nouvelle tentative, et les catégories obtenues sont gardées même si une échoue
      const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
      const responses: { category: (typeof PLACE_CATEGORIES)[number]; json: unknown }[] = [];
      for (const { category, url } of photonUrls(coords.lat, coords.lng, photonUrl)) {
        for (let attempt = 0; attempt < 2; attempt++) {
          try {
            const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
            if (res.ok) {
              responses.push({ category, json: await res.json() });
              break;
            }
          } catch {
            // nouvelle tentative
          }
          await pause(1200);
        }
        // Photon injoignable dès la première catégorie : inutile d'insister, on passe au serveur
        if (!responses.length) break;
        await pause(300);
      }
      if (responses.length) return send(parsePhoton(responses as Parameters<typeof parsePhoton>[0], coords.lat, coords.lng), responses.map((r) => r.category));
    }
    return importNearbyPlaces(propertyId);
  };
  const imported = places.filter((p) => p.source === "openstreetmap");
  return (
    <Card className="space-y-5 p-5" data-testid="places-manager">
      <div>
        <h2 className="text-[17px] font-semibold">{t("title")}</h2>
        <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      </div>

      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">{t("ownTitle")}</h3>
        <PlaceForm key={editing?.id ?? "new"} propertyId={propertyId} place={editing} onDone={() => setEditing(null)} homeAddress={homeAddress} visibilityReady={visibilityReady} />
        <ul className="divide-y divide-line" data-testid="places-list">
          {own.length === 0 && <li className="py-2 text-[14px] text-muted">{t("none")}</li>}
          {own.map((p) => (
            <PlaceRow key={p.id} p={p} label={tc(p.category)} date={f.dateTime(new Date(p.updated_at), { dateStyle: "medium" })} onEdit={() => setEditing(p)} home={visibilityReady ? { lat: coords?.lat ?? null, lng: coords?.lng ?? null, address: homeAddress } : null} />
          ))}
        </ul>
      </section>

      <section className="space-y-2 border-t border-line pt-4">
        <h3 className="text-[15px] font-semibold">{t("autoTitle")}</h3>
        <p className="text-[13px] text-muted">{t("autoSource")}</p>
        <label className="flex items-center gap-2 text-[15px]">
          <input
            type="checkbox"
            checked={autoOn}
            disabled={auto.pending}
            onChange={(e) => {
              const v = e.target.checked;
              setAutoOn(v);
              // Échec serveur : la case revient à l'état réellement enregistré
              auto.run(async () => {
                const r = await setAutoPlaces(propertyId, v);
                if (!r.ok) setAutoOn(!v);
                return r;
              });
            }}
            data-testid="places-auto"
          />
          {t("autoToggle")}
        </label>
        {auto.error && <p role="alert" className="text-[13px] text-danger">{auto.error}</p>}
        <p className="text-[14px]" data-testid="places-coords">
          {coords ? t("located", { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5), source: geoSource === "manager" ? t("sourceManual") : "OpenStreetMap" }) : t("notLocated")}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" onClick={() => locate.run(() => locateProperty(propertyId))} disabled={locate.pending} data-testid="places-locate">
            {locate.pending ? t("locating") : t("locate")}
          </Button>
          <Input aria-label={t("lat")} placeholder={t("lat")} value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} className="w-32" inputMode="decimal" data-testid="places-lat" />
          <Input aria-label={t("lng")} placeholder={t("lng")} value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} className="w-32" inputMode="decimal" data-testid="places-lng" />
          <Button size="sm" variant="ghost" onClick={() => locate.run(() => locateProperty(propertyId, { lat: Number(manual.lat.replace(",", ".")), lng: Number(manual.lng.replace(",", ".")) }))} disabled={locate.pending || !manual.lat || !manual.lng} data-testid="places-save-coords">
            {t("saveCoords")}
          </Button>
        </div>
        {locate.error && <p role="alert" className="text-[13px] text-danger" data-testid="places-locate-error">{locate.error}</p>}
        {autoOn && (
          <div className="space-y-1">
            <Button size="sm" onClick={() => imp.run(() => importFromBrowser(), (d) => setMsg(t("imported", { count: d.count }) + ("missing" in d && Array.isArray(d.missing) && d.missing.length ? ` ${t("importedPartial", { categories: d.missing.map((c: string) => tc(c as PlaceCategory)).join(", ") })}` : "")))} disabled={imp.pending || !coords} data-testid="places-import">
              {imp.pending ? t("importing") : t("import")}
            </Button>
            {!coords && <p className="text-[12px] text-warning">{t("needCoords")}</p>}
            <p className="text-[12px] text-muted">{t("importHint")}</p>
            {msg && <p className="text-[13px] text-success" role="status" data-testid="places-imported">{msg}</p>}
            {imp.error && <p role="alert" className="text-[13px] text-danger" data-testid="places-import-error">{imp.error}</p>}
          </div>
        )}
        {!autoOn && <p className="text-[13px] text-muted" data-testid="places-auto-off">{t("autoOff")}</p>}
        <ul className={cn("divide-y divide-line", !autoOn && "opacity-50")}>
          {imported.map((p) => (
            <PlaceRow key={p.id} p={p} label={tc(p.category)} date={f.dateTime(new Date(p.updated_at), { dateStyle: "medium" })} />
          ))}
        </ul>
      </section>
    </Card>
  );
}

function PlaceForm({ propertyId, place, onDone, homeAddress, visibilityReady }: { propertyId: string; place: Place | null; onDone: () => void; homeAddress: string | null; visibilityReady: boolean }) {
  const t = useTranslations("connected.places");
  const tc = useTranslations("places.category");
  const { pending, error, run } = useRun();
  const empty: PlaceInput = { source: "manager", category: "food", name: "", description: "", address: "", openingHours: "", phone: "", website: "", note: "", ...(visibilityReady ? { guestVisibility: "access" as const } : {}) };
  const [form, setForm] = useState<PlaceInput>(
    place
      ? { source: place.source === "owner" ? "owner" : "manager", category: place.category, name: place.name, description: place.description ?? "", address: place.address ?? "", openingHours: place.opening_hours ?? "", phone: place.phone ?? "", website: place.website ?? "", note: place.note ?? "", ...(visibilityReady ? { guestVisibility: place.guest_visibility === "booking" ? ("booking" as const) : ("access" as const) } : {}) }
      : empty,
  );
  const set = (k: keyof PlaceInput, v: string) => setForm({ ...form, [k]: v });
  const early = form.guestVisibility === "booking";
  const homeStreet = streetOf(homeAddress);
  const sameStreet = early && !!homeStreet && homeStreet.length >= 4 && (form.address ?? "").toLowerCase().includes(homeStreet);
  return (
    <form
      className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => (place ? updatePlace(place.id, form) : addPlace(propertyId, form)), () => {
          setForm(empty);
          onDone();
        });
      }}
      data-testid="place-form"
    >
      <p className="text-[15px] font-medium sm:col-span-2">{place ? t("editTitle") : t("addTitle")}</p>
      <Field label={t("name")} htmlFor="pl-name">
        <Input id="pl-name" value={form.name} onChange={(e) => set("name", e.target.value)} required maxLength={160} data-testid="place-name" />
      </Field>
      <Field label={t("category")} htmlFor="pl-cat">
        <Select id="pl-cat" value={form.category} onChange={(e) => set("category", e.target.value)} data-testid="place-category">
          {PLACE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {tc(c)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t("origin")} htmlFor="pl-src">
        <Select id="pl-src" value={form.source} onChange={(e) => set("source", e.target.value)} data-testid="place-source">
          <option value="manager">{t("originTeam")}</option>
          <option value="owner">{t("originOwner")}</option>
        </Select>
      </Field>
      <Field label={t("address")} htmlFor="pl-addr" hint={t("addressHint")}>
        <Input id="pl-addr" value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={300} data-testid="place-address" />
      </Field>
      <Field label={t("description")} htmlFor="pl-desc" className="sm:col-span-2">
        <Input id="pl-desc" value={form.description} onChange={(e) => set("description", e.target.value)} maxLength={300} data-testid="place-description" />
        {early && revealsHome(form.description) && <p className="mt-1 text-[12px] text-warning" data-testid="place-description-masked">{t("textMasked")}</p>}
      </Field>
      <Field label={t("note")} htmlFor="pl-note" className="sm:col-span-2">
        <Input id="pl-note" value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={500} data-testid="place-note" />
        {early && revealsHome(form.note) && <p className="mt-1 text-[12px] text-warning" data-testid="place-note-masked">{t("textMasked")}</p>}
      </Field>
      {visibilityReady ? (
        <Field label={t("visibility")} htmlFor="pl-vis" className="sm:col-span-2" hint={t("visibilityHint")}>
          <Select id="pl-vis" value={form.guestVisibility ?? "access"} onChange={(e) => set("guestVisibility", e.target.value)} data-testid="place-visibility">
            <option value="access">{t("visibilityAccess")}</option>
            <option value="booking">{t("visibilityBooking")}</option>
          </Select>
          {sameStreet && <p className="mt-1 text-[12px] text-warning" data-testid="place-same-street">{t("sameStreetWarn")}</p>}
        </Field>
      ) : (
        <p className="text-[12px] text-muted sm:col-span-2" data-testid="place-visibility-unavailable">{t("visibilityUnavailable")}</p>
      )}
      <Field label={t("hours")} htmlFor="pl-hours" hint={t("hoursHint")}>
        <Input id="pl-hours" value={form.openingHours} onChange={(e) => set("openingHours", e.target.value)} maxLength={300} data-testid="place-hours" />
      </Field>
      <Field label={t("phone")} htmlFor="pl-phone">
        <Input id="pl-phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} maxLength={40} />
      </Field>
      <div className="flex items-center gap-3 sm:col-span-2">
        <Button type="submit" size="sm" disabled={pending || !form.name.trim()} data-testid="place-add">
          {place ? t("save") : t("add")}
        </Button>
        {place && (
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            {t("cancel")}
          </Button>
        )}
        {error && <span role="alert" className="text-[13px] text-danger">{error}</span>}
      </div>
    </form>
  );
}

function PlaceRow({ p, label, date, onEdit, home }: { p: Place; label: string; date: string; onEdit?: () => void; home?: { lat: number | null; lng: number | null; address: string | null } | null }) {
  const t = useTranslations("connected.places");
  const { pending, error, run } = useRun();
  const ba = home && p.source !== "openstreetmap" ? beforeAccess(p, home) : null;
  return (
    <li className={cn("flex flex-wrap items-center gap-2 py-2.5", p.hidden && "opacity-50")} data-testid="place-row" data-source={p.source}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{p.name}</span>
        <span className="block text-[12px] text-muted">
          {label} · {p.source === "manager" ? t("originTeam") : p.source === "owner" ? t("originOwner") : "OpenStreetMap"} · {date}
          {p.verified_at ? ` · ${t("verified")}` : p.source !== "openstreetmap" ? ` · ${t("notVerified")}` : ""}
          {p.distance_m != null ? ` · ${fmtDistance(p.distance_m)}` : ` · ${t("noDistance")}`}
          {p.hidden && ` · ${t("hidden")}`}
        </span>
        {ba && !p.hidden && (
          <span className="mt-1 flex flex-wrap gap-1.5 text-[12px]" data-testid="place-visibility-badge" data-state={ba}>
            <span className={cn("rounded-full px-2 py-0.5", ba === "booking" ? "bg-accent-soft text-accent-text" : ba === "access" ? "bg-subtle text-muted" : "bg-warning-soft text-warning")}>{t(`badge.${ba}`)}</span>
            {ba === "booking" && p.lat == null && <span className="rounded-full bg-warning-soft px-2 py-0.5 text-warning" data-testid="place-no-position">{t("badge.noPosition")}</span>}
          </span>
        )}
      </span>
      {!p.verified_at && p.source !== "openstreetmap" && (
        <Button size="sm" variant="ghost" onClick={() => run(() => verifyPlace(p.id))} disabled={pending} data-testid="place-verify" title={t("verifyHint")}>
          {t("verify")}
        </Button>
      )}
      {onEdit && (
        <Button size="sm" variant="ghost" onClick={onEdit} disabled={pending} data-testid="place-edit">
          {t("edit")}
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={() => run(() => setPlaceHidden(p.id, !p.hidden))} disabled={pending} data-testid="place-toggle">
        {p.hidden ? t("show") : t("hide")}
      </Button>
      {p.source !== "openstreetmap" && (
        <Button size="sm" variant="ghost" onClick={() => run(() => deletePlace(p.id))} disabled={pending} data-testid="place-delete">
          {t("delete")}
        </Button>
      )}
      {error && <span role="alert" className="basis-full text-[13px] text-danger">{error}</span>}
    </li>
  );
}
