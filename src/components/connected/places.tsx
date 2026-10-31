"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Clock, Globe, MapPin, Navigation, Phone } from "lucide-react";
import { addPlace, deletePlace, importNearbyPlaces, locateProperty, setAutoPlaces, setPlaceHidden, storeImportedPlaces, updatePlace, verifyPlace, type PlaceInput } from "@/lib/connected/actions";
import { directionsLink, MAPS_APPS, type MapsApp } from "@/lib/engine/directions";
import { overpassQuery, parseOverpass, parsePhoton, photonUrls, PLACE_CATEGORIES, type PlaceCategory } from "@/lib/engine/places";
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
  hidden?: boolean;
  created_at?: string | null;
  verified_at?: string | null;
}

/**
 * Carte OpenStreetMap (Leaflet) : le logement et les lieux affichés. Tuiles et attribution OpenStreetMap.
 * Si les tuiles ne chargent pas (réseau), la liste reste complète et utilisable.
 */
function PlacesMap({ center, places, onTilesFailed }: { center: { lat: number; lng: number }; places: Place[]; onTilesFailed: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<import("leaflet").Map | null>(null);
  const layer = useRef<import("leaflet").LayerGroup | null>(null);
  const [L, setL] = useState<typeof import("leaflet") | null>(null);
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
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    })
      // Fond de carte indisponible (hors connexion, service saturé) : on le dit, la liste reste utilisable
      .on("tileerror", () => {
        if (!failed) {
          failed = true;
          onTilesFailed();
        }
      })
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
    const dot = (color: string, size: number) =>
      L.divIcon({ className: "", html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`, iconSize: [size, size] });
    L.marker([center.lat, center.lng], { icon: dot("#0055FF", 18), zIndexOffset: 1000 }).addTo(layer.current);
    const pts: [number, number][] = [[center.lat, center.lng]];
    for (const p of places) {
      if (p.lat == null || p.lng == null) continue;
      L.marker([p.lat, p.lng], { icon: dot(p.source === "openstreetmap" ? "#334155" : "#d97706", 12), title: p.name }).bindTooltip(p.name).addTo(layer.current);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 });
  }, [L, places, center.lat, center.lng]);
  return <div ref={el} className="h-64 w-full overflow-hidden rounded-lg border border-line bg-subtle md:h-80" data-testid="places-map" role="img" aria-label="Carte" />;
}

/** Distance volontairement arrondie (à vol d'oiseau depuis le logement) : jamais une fausse précision. */
export const fmtDistance = (m: number) => (m < 100 ? "< 100 m" : m < 1000 ? `≈ ${Math.round(m / 50) * 50} m` : `≈ ${(Math.round(m / 100) / 10).toFixed(1).replace(".", ",")} km`);

/**
 * Autour du logement (voyageur) : organisé autour de l'ADRESSE DU LOGEMENT (aucune position demandée).
 * Pour chaque lieu : origine (équipe, propriétaire ou proposé automatiquement), distance arrondie,
 * adresse, horaires seulement si la source les fournit, itinéraire Plans / Google Maps / Waze.
 */
export function GuestAround({ property, places, hiddenUntil }: { property: { name: string; lat: number | null; lng: number | null; address: string }; places: Place[]; /** Avant la fenêtre habituelle : carte et adresse volontairement masquées jusqu'à cette date */ hiddenUntil?: string }) {
  const t = useTranslations("guestSpace.around");
  const tc = useTranslations("places.category");
  const f = useFormatter();
  const [cat, setCat] = useState<PlaceCategory | "all">("all");
  const [tilesFailed, setTilesFailed] = useState(false);
  const center = property.lat != null && property.lng != null ? { lat: property.lat, lng: property.lng } : null;
  const shown = useMemo(() => places.filter((p) => cat === "all" || p.category === cat), [places, cat]);
  const counts = useMemo(() => Object.fromEntries(PLACE_CATEGORIES.map((c) => [c, places.filter((p) => p.category === c).length])), [places]);
  const latestOsm = places.filter((p) => p.source === "openstreetmap").map((p) => p.updated_at).sort().at(-1);
  const sourceLabel = (s: Place["source"]) => (s === "manager" ? t("byTeam") : s === "owner" ? t("byOwner") : t("byOsm"));
  return (
    <section className="space-y-3" data-testid="guest-around">
      <h2 className="text-title-3">{t("title")}</h2>
      {places.length === 0 ? (
        <Card className="p-5 text-[15px] text-muted" data-testid="around-empty">
          {t("empty")}
        </Card>
      ) : (
        <>
          <p className="text-[14px] text-muted" data-testid="around-origin">
            {center ? t("originHome", { address: property.address || property.name }) : hiddenUntil ? t("mapLater", { date: hiddenUntil }) : t("noCoordinates")}
          </p>
          {center && <PlacesMap center={center} places={shown} onTilesFailed={() => setTilesFailed(true)} />}
          {tilesFailed && (
            <p className="text-[13px] text-warning" role="status" data-testid="around-map-offline">
              {t("mapUnavailable")}
            </p>
          )}
          <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="tablist">
            {(["all", ...PLACE_CATEGORIES] as const)
              .filter((c) => c === "all" || counts[c])
              .map((c) => (
                <button
                  key={c}
                  type="button"
                  role="tab"
                  aria-selected={cat === c}
                  onClick={() => setCat(c)}
                  className={cn("h-9 shrink-0 rounded-full border px-3.5 text-[14px] font-medium", cat === c ? "border-accent bg-accent text-white" : "border-line bg-surface text-fg")}
                  data-testid={`around-filter-${c}`}
                >
                  {c === "all" ? t("all") : tc(c)}
                  {c !== "all" && <span className="ms-1 opacity-70">{counts[c]}</span>}
                </button>
              ))}
          </div>
          <ul className="space-y-2">
            {shown.map((p) => {
              const dest = { name: p.name, addressLine: p.address ?? undefined, lat: p.lat ?? undefined, lng: p.lng ?? undefined };
              const routable = Boolean(p.address) || (p.lat != null && p.lng != null);
              return (
                <li key={p.id}>
                  <Card className="p-4" data-testid="around-place" data-category={p.category} data-source={p.source}>
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-[16px] font-semibold">{p.name}</p>
                        <p className="text-[13px] text-muted">
                          {tc(p.category)}
                          {p.distance_m != null && <span data-testid="around-distance"> · {fmtDistance(p.distance_m)}</span>}
                        </p>
                      </div>
                      <span
                        className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", p.source === "openstreetmap" ? "bg-subtle text-muted dark:bg-surface-hover" : "bg-warning-soft text-warning")}
                        data-testid="around-source"
                      >
                        {sourceLabel(p.source)}
                      </span>
                    </div>
                    {p.description && <p className="mt-2 text-[14px]">{p.description}</p>}
                    {p.note && (
                      <p className="mt-1 text-[14px]">
                        <span className="font-medium">{t("tip")}</span> {p.note}
                      </p>
                    )}
                    <div className="mt-2 space-y-1 text-[14px] text-muted">
                      {p.address && (
                        <p className="flex gap-1.5">
                          <MapPin className="mt-0.5 size-4 shrink-0" />
                          {p.address}
                        </p>
                      )}
                      <p className="flex gap-1.5" data-testid="around-hours">
                        <Clock className="mt-0.5 size-4 shrink-0" />
                        {p.opening_hours ? (
                          <span>
                            {p.opening_hours} <span className="text-[12px]">({p.source === "openstreetmap" ? t("hoursAsPublished") : p.verified_at ? t("hoursVerified") : t("hoursToConfirm")})</span>
                          </span>
                        ) : (
                          <span className="text-[13px]">{t("noHours")}</span>
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
                    {routable ? (
                      <div className="mt-3 flex flex-wrap gap-1.5">
                        {MAPS_APPS.map((app: MapsApp) => (
                          <a
                            key={app}
                            href={directionsLink(app, dest)}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 text-[13px] font-medium hover:bg-surface-hover"
                            data-testid={`around-go-${app}`}
                          >
                            <Navigation className="size-3.5" />
                            {t(`app.${app}`)}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-[12px] text-muted">{t("noRoute")}</p>
                    )}
                    <p className="mt-2 text-[11px] text-faint">
                      {p.source === "openstreetmap"
                        ? t("osmData", { date: f.dateTime(new Date(p.updated_at), { dateStyle: "medium" }) })
                        : p.verified_at
                          ? t("verifiedOn", { date: f.dateTime(new Date(p.verified_at), { dateStyle: "medium" }) })
                          : t(p.source === "owner" ? "ownerAddedOn" : "addedOn", { date: f.dateTime(new Date(p.created_at ?? p.updated_at), { dateStyle: "medium" }) })}
                    </p>
                  </Card>
                </li>
              );
            })}
          </ul>
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
}: {
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
      const send = (parsed: ReturnType<typeof parseOverpass>) =>
        storeImportedPlaces(
          propertyId,
          parsed.places.map((x) => ({ externalId: x.externalId, category: x.category, name: x.name, address: x.address, lat: x.lat, lng: x.lng, openingHours: x.openingHours, phone: x.phone, website: x.website })),
          parsed.dataDate,
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
      try {
        const responses = await Promise.all(
          photonUrls(coords.lat, coords.lng, photonUrl).map(async ({ category, url }) => {
            const res = await fetch(url, { signal: AbortSignal.timeout(12_000) });
            if (!res.ok) throw new Error(String(res.status));
            return { category, json: await res.json() };
          }),
        );
        return send(parsePhoton(responses, coords.lat, coords.lng));
      } catch {
        // dernier recours : serveur HALO
      }
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
        <PlaceForm key={editing?.id ?? "new"} propertyId={propertyId} place={editing} onDone={() => setEditing(null)} />
        <ul className="divide-y divide-line" data-testid="places-list">
          {own.length === 0 && <li className="py-2 text-[14px] text-muted">{t("none")}</li>}
          {own.map((p) => (
            <PlaceRow key={p.id} p={p} label={tc(p.category)} date={f.dateTime(new Date(p.updated_at), { dateStyle: "medium" })} onEdit={() => setEditing(p)} />
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
            <Button size="sm" onClick={() => imp.run(() => importFromBrowser(), (d) => setMsg(t("imported", { count: d.count })))} disabled={imp.pending || !coords} data-testid="places-import">
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

function PlaceForm({ propertyId, place, onDone }: { propertyId: string; place: Place | null; onDone: () => void }) {
  const t = useTranslations("connected.places");
  const tc = useTranslations("places.category");
  const { pending, error, run } = useRun();
  const empty: PlaceInput = { source: "manager", category: "food", name: "", description: "", address: "", openingHours: "", phone: "", website: "", note: "" };
  const [form, setForm] = useState<PlaceInput>(
    place
      ? { source: place.source === "owner" ? "owner" : "manager", category: place.category, name: place.name, description: place.description ?? "", address: place.address ?? "", openingHours: place.opening_hours ?? "", phone: place.phone ?? "", website: place.website ?? "", note: place.note ?? "" }
      : empty,
  );
  const set = (k: keyof PlaceInput, v: string) => setForm({ ...form, [k]: v });
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
      </Field>
      <Field label={t("note")} htmlFor="pl-note" className="sm:col-span-2">
        <Input id="pl-note" value={form.note} onChange={(e) => set("note", e.target.value)} maxLength={500} data-testid="place-note" />
      </Field>
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

function PlaceRow({ p, label, date, onEdit }: { p: Place; label: string; date: string; onEdit?: () => void }) {
  const t = useTranslations("connected.places");
  const { pending, error, run } = useRun();
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
