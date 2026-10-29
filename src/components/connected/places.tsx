"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Clock, Crosshair, Globe, MapPin, Navigation, Phone } from "lucide-react";
import { addPlace, deletePlace, importNearbyPlaces, locateProperty, setPlaceHidden } from "@/lib/connected/actions";
import { directionsLink, MAPS_APPS, type MapsApp } from "@/lib/engine/directions";
import { distanceM, PLACE_CATEGORIES, type PlaceCategory } from "@/lib/engine/places";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useRun } from "./use-run";

export interface Place {
  id: string;
  source: "manager" | "openstreetmap";
  category: PlaceCategory;
  name: string;
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
}

/**
 * Carte OpenStreetMap (Leaflet) : le logement et les lieux affichés. Tuiles et attribution OpenStreetMap.
 * Si les tuiles ne chargent pas (réseau), la liste reste complète et utilisable.
 */
function PlacesMap({ center, places, me }: { center: { lat: number; lng: number }; places: Place[]; me: { lat: number; lng: number } | null }) {
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
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
    }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => {
      map.current?.remove();
      map.current = null;
    };
  }, [L, center.lat, center.lng]);
  useEffect(() => {
    if (!L || !layer.current || !map.current) return;
    layer.current.clearLayers();
    const dot = (color: string, size: number) =>
      L.divIcon({ className: "", html: `<span style="display:block;width:${size}px;height:${size}px;border-radius:50%;background:${color};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></span>`, iconSize: [size, size] });
    L.marker([center.lat, center.lng], { icon: dot("#0055FF", 18), zIndexOffset: 1000 }).addTo(layer.current);
    if (me) L.marker([me.lat, me.lng], { icon: dot("#16a34a", 14) }).addTo(layer.current);
    const pts: [number, number][] = [[center.lat, center.lng]];
    for (const p of places) {
      if (p.lat == null || p.lng == null) continue;
      L.marker([p.lat, p.lng], { icon: dot(p.source === "manager" ? "#d97706" : "#334155", 12), title: p.name }).bindTooltip(p.name).addTo(layer.current);
      pts.push([p.lat, p.lng]);
    }
    if (pts.length > 1) map.current.fitBounds(L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 });
  }, [L, places, me, center.lat, center.lng]);
  return <div ref={el} className="h-64 w-full overflow-hidden rounded-lg border border-line bg-subtle md:h-80" data-testid="places-map" role="img" aria-label="Carte" />;
}

const fmtDistance = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1).replace(".", ",")} km`);

/**
 * Autour du logement (voyageur) : carte, filtres, distance, adresse, horaires, source et date.
 * Par défaut, tout est calculé depuis le logement ; la position du voyageur n'est demandée que s'il
 * la propose (« depuis ma position »), n'est jamais envoyée au serveur, et un refus ne bloque rien.
 */
export function GuestAround({ property, places }: { property: { name: string; lat: number | null; lng: number | null; address: string }; places: Place[] }) {
  const t = useTranslations("guestSpace.around");
  const tc = useTranslations("places.category");
  const f = useFormatter();
  const [cat, setCat] = useState<PlaceCategory | "all">("all");
  const [me, setMe] = useState<{ lat: number; lng: number } | null>(null);
  const [geo, setGeo] = useState<"idle" | "asking" | "denied" | "unavailable" | "on">("idle");
  const center = property.lat != null && property.lng != null ? { lat: property.lat, lng: property.lng } : null;
  const shown = useMemo(() => {
    const list = places.filter((p) => cat === "all" || p.category === cat);
    if (!me) return list;
    return [...list].sort((a, b) => (a.lat == null ? 1 : b.lat == null ? -1 : distanceM(me.lat, me.lng, a.lat, a.lng!) - distanceM(me.lat, me.lng, b.lat, b.lng!)));
  }, [places, cat, me]);
  const counts = useMemo(() => Object.fromEntries(PLACE_CATEGORIES.map((c) => [c, places.filter((p) => p.category === c).length])), [places]);
  const sources = Array.from(new Set(places.map((p) => p.source)));
  const latestOsm = places.filter((p) => p.source === "openstreetmap").map((p) => p.updated_at).sort().at(-1);
  if (!places.length) return null;
  const askPosition = () => {
    if (!("geolocation" in navigator)) return setGeo("unavailable");
    setGeo("asking");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeo("on");
      },
      (err) => setGeo(err.code === err.PERMISSION_DENIED ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  };
  return (
    <section className="space-y-3" data-testid="guest-around">
      <div className="flex flex-wrap items-end gap-2">
        <h2 className="flex-1 text-title-3">{t("title")}</h2>
        {center && geo !== "on" && (
          <Button size="sm" variant="outline" onClick={askPosition} disabled={geo === "asking"} data-testid="around-geolocate">
            <Crosshair />
            {t("fromMe")}
          </Button>
        )}
        {geo === "on" && (
          <Button size="sm" variant="ghost" onClick={() => (setMe(null), setGeo("idle"))} data-testid="around-from-home">
            {t("fromHome")}
          </Button>
        )}
      </div>
      <p className="text-[14px] text-muted" data-testid="around-origin">
        {geo === "on" ? t("originMe") : t("originHome", { address: property.address || property.name })}
        {geo === "denied" && <span className="block text-warning" data-testid="around-denied">{t("denied")}</span>}
        {geo === "unavailable" && <span className="block text-warning">{t("unavailable")}</span>}
      </p>
      {center && <PlacesMap center={center} places={shown} me={me} />}
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
          const d = me && p.lat != null && p.lng != null ? distanceM(me.lat, me.lng, p.lat, p.lng) : p.distance_m;
          const dest = { name: p.name, addressLine: p.address ?? undefined, lat: p.lat ?? undefined, lng: p.lng ?? undefined };
          return (
            <li key={p.id}>
              <Card className="p-4" data-testid="around-place" data-category={p.category} data-source={p.source}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[16px] font-semibold">{p.name}</p>
                    <p className="text-[13px] text-muted">
                      {tc(p.category)}
                      {d != null && <span data-testid="around-distance"> · {fmtDistance(d)}</span>}
                    </p>
                  </div>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium", p.source === "manager" ? "bg-warning-soft text-warning" : "bg-subtle text-muted dark:bg-surface-hover")}>
                    {p.source === "manager" ? t("byTeam") : "OpenStreetMap"}
                  </span>
                </div>
                {p.note && <p className="mt-2 text-[14px]">« {p.note} »</p>}
                <div className="mt-2 space-y-1 text-[14px] text-muted">
                  {p.address && (
                    <p className="flex gap-1.5">
                      <MapPin className="mt-0.5 size-4 shrink-0" />
                      {p.address}
                    </p>
                  )}
                  {p.opening_hours && (
                    <p className="flex gap-1.5" data-testid="around-hours">
                      <Clock className="mt-0.5 size-4 shrink-0" />
                      <span>
                        {p.opening_hours} <span className="text-[12px]">({t("hoursAsPublished")})</span>
                      </span>
                    </p>
                  )}
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
                {(p.address || p.lat != null) && (
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
                )}
                <p className="mt-2 text-[11px] text-faint">
                  {p.source === "manager" ? t("verifiedOn", { date: f.dateTime(new Date(p.updated_at), { dateStyle: "medium" }) }) : t("osmData", { date: f.dateTime(new Date(p.updated_at), { dateStyle: "medium" }) })}
                </p>
              </Card>
            </li>
          );
        })}
      </ul>
      <p className="text-[12px] text-faint" data-testid="around-sources">
        {t("sources", { list: sources.map((s) => (s === "manager" ? t("byTeam") : "OpenStreetMap")).join(" · ") })}
        {latestOsm && ` · ${t("osmData", { date: f.dateTime(new Date(latestOsm), { dateStyle: "medium" }) })}`}
        {" · "}
        {t("notBookable")}
      </p>
    </section>
  );
}

/** Gestion des lieux (responsable) : localisation, import OpenStreetMap, lieux vérifiés par l'équipe. */
export function PlacesManager({
  propertyId,
  coords,
  geoSource,
  places,
}: {
  propertyId: string;
  coords: { lat: number; lng: number } | null;
  geoSource: string | null;
  places: Place[];
}) {
  const t = useTranslations("connected.places");
  const tc = useTranslations("places.category");
  const f = useFormatter();
  const locate = useRun();
  const imp = useRun();
  const add = useRun();
  const [manual, setManual] = useState({ lat: coords?.lat?.toString() ?? "", lng: coords?.lng?.toString() ?? "" });
  const [form, setForm] = useState({ category: "food", name: "", address: "", openingHours: "", phone: "", website: "", note: "" });
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <Card className="space-y-4 p-5" data-testid="places-manager">
      <div>
        <h2 className="text-[17px] font-semibold">{t("title")}</h2>
        <p className="mt-1 text-[14px] text-muted">{t("text")}</p>
      </div>
      <div className="space-y-2">
        <p className="text-[14px]" data-testid="places-coords">
          {coords ? t("located", { lat: coords.lat.toFixed(5), lng: coords.lng.toFixed(5), source: geoSource === "manager" ? t("sourceManual") : "OpenStreetMap" }) : t("notLocated")}
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <Button size="sm" variant="outline" onClick={() => locate.run(() => locateProperty(propertyId))} disabled={locate.pending} data-testid="places-locate">
            {t("locate")}
          </Button>
          <Input aria-label={t("lat")} placeholder={t("lat")} value={manual.lat} onChange={(e) => setManual({ ...manual, lat: e.target.value })} className="w-32" inputMode="decimal" data-testid="places-lat" />
          <Input aria-label={t("lng")} placeholder={t("lng")} value={manual.lng} onChange={(e) => setManual({ ...manual, lng: e.target.value })} className="w-32" inputMode="decimal" data-testid="places-lng" />
          <Button size="sm" variant="ghost" onClick={() => locate.run(() => locateProperty(propertyId, { lat: Number(manual.lat.replace(",", ".")), lng: Number(manual.lng.replace(",", ".")) }))} disabled={locate.pending || !manual.lat || !manual.lng} data-testid="places-save-coords">
            {t("saveCoords")}
          </Button>
        </div>
        {locate.error && <p role="alert" className="text-[13px] text-danger">{locate.error}</p>}
      </div>
      <div className="space-y-1">
        <Button size="sm" onClick={() => imp.run(() => importNearbyPlaces(propertyId), (d) => setMsg(t("imported", { count: d.count })))} disabled={imp.pending || !coords} data-testid="places-import">
          {imp.pending ? t("importing") : t("import")}
        </Button>
        <p className="text-[12px] text-muted">{t("importHint")}</p>
        {msg && <p className="text-[13px] text-success" role="status" data-testid="places-imported">{msg}</p>}
        {imp.error && <p role="alert" className="text-[13px] text-danger" data-testid="places-import-error">{imp.error}</p>}
      </div>
      <form
        className="grid gap-3 rounded-lg border border-line p-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          add.run(() => addPlace(propertyId, form), () => setForm({ ...form, name: "", address: "", openingHours: "", phone: "", website: "", note: "" }));
        }}
      >
        <p className="text-[15px] font-medium sm:col-span-2">{t("addTitle")}</p>
        <Field label={t("name")} htmlFor="pl-name">
          <Input id="pl-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={160} data-testid="place-name" />
        </Field>
        <Field label={t("category")} htmlFor="pl-cat">
          <Select id="pl-cat" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} data-testid="place-category">
            {PLACE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {tc(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("address")} htmlFor="pl-addr" className="sm:col-span-2">
          <Input id="pl-addr" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={300} data-testid="place-address" />
        </Field>
        <Field label={t("hours")} htmlFor="pl-hours" hint={t("hoursHint")}>
          <Input id="pl-hours" value={form.openingHours} onChange={(e) => setForm({ ...form, openingHours: e.target.value })} maxLength={300} />
        </Field>
        <Field label={t("phone")} htmlFor="pl-phone">
          <Input id="pl-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} />
        </Field>
        <Field label={t("note")} htmlFor="pl-note" className="sm:col-span-2">
          <Input id="pl-note" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={500} data-testid="place-note" />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={add.pending || !form.name.trim()} data-testid="place-add">
            {t("add")}
          </Button>
          {add.error && <span role="alert" className="text-[13px] text-danger">{add.error}</span>}
        </div>
      </form>
      <ul className="divide-y divide-line" data-testid="places-list">
        {places.length === 0 && <li className="py-2 text-[14px] text-muted">{t("none")}</li>}
        {places.map((p) => (
          <PlaceRow key={p.id} p={p} label={tc(p.category)} date={f.dateTime(new Date(p.updated_at), { dateStyle: "medium" })} />
        ))}
      </ul>
    </Card>
  );
}

function PlaceRow({ p, label, date }: { p: Place; label: string; date: string }) {
  const t = useTranslations("connected.places");
  const { pending, error, run } = useRun();
  return (
    <li className={cn("flex flex-wrap items-center gap-2 py-2.5", p.hidden && "opacity-50")} data-testid="place-row" data-source={p.source}>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{p.name}</span>
        <span className="block text-[12px] text-muted">
          {label} · {p.source === "manager" ? t("byTeam") : "OpenStreetMap"} · {date}
          {p.distance_m != null && ` · ${p.distance_m} m`}
        </span>
      </span>
      <Button size="sm" variant="ghost" onClick={() => run(() => setPlaceHidden(p.id, !p.hidden))} disabled={pending} data-testid="place-toggle">
        {p.hidden ? t("show") : t("hide")}
      </Button>
      {p.source === "manager" && (
        <Button size="sm" variant="ghost" onClick={() => run(() => deletePlace(p.id))} disabled={pending}>
          {t("delete")}
        </Button>
      )}
      {error && <span role="alert" className="basis-full text-[13px] text-danger">{error}</span>}
    </li>
  );
}
