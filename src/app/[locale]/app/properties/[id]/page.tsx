import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { GuideEditor } from "@/components/connected/property-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { PlacesManager, type Place } from "@/components/connected/places";
import { SourcesPanel, type SourceRow } from "@/components/connected/sources-panel";
import { distanceM } from "@/lib/engine/places";

export default async function PropertyPage({ params }: PageProps<"/[locale]/app/properties/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.properties");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const [{ data: p }, { data: g }, { data: rooms }, { data: placeRows }, { data: sources }, { data: conflicts }] = await Promise.all([
    supabase.from("properties").select("id, name, city, address_line, timezone, default_check_in, default_check_out, latitude, longitude, geo_source, auto_places").eq("organization_id", org!.id).eq("id", id).maybeSingle(),
    supabase.from("guest_guides").select("*").eq("organization_id", org!.id).eq("property_id", id).maybeSingle(),
    supabase.from("checklist_rooms").select("id, name, checklist_items(label, photo_required)").eq("organization_id", org!.id).eq("property_id", id).order("sort"),
    supabase.from("property_places").select("*").eq("organization_id", org!.id).eq("property_id", id).order("source").order("name"),
    supabase.from("data_sources").select("id, label, platform, url_hint, status, last_sync_at, last_success_at, last_error, last_counts").eq("organization_id", org!.id).eq("property_id", id).order("created_at"),
    supabase.from("source_events").select("source_id, uid, conflict, feed_start, feed_end, reservation_id, reservations(guest_name, check_in_at), data_sources!inner(property_id)").eq("organization_id", org!.id).eq("state", "conflict").eq("data_sources.property_id", id).limit(50),
  ]);
  if (!p) notFound();
  const coords = p.latitude != null && p.longitude != null ? { lat: p.latitude as number, lng: p.longitude as number } : null;
  const places: Place[] = (placeRows ?? []).map((x) => ({
    id: x.id,
    source: x.source,
    category: x.category,
    name: x.name,
    description: x.description,
    address: x.address,
    lat: x.latitude,
    lng: x.longitude,
    opening_hours: x.opening_hours,
    phone: x.phone,
    website: x.website,
    note: x.note,
    updated_at: x.source_updated_at,
    hidden: x.hidden,
    created_at: x.created_at,
    verified_at: x.verified_at,
    distance_m: coords && x.latitude != null ? distanceM(coords.lat, coords.lng, x.latitude, x.longitude) : null,
  }));
  return (
    <>
      <PageHeader title={p.name} subtitle={[p.address_line, p.city].filter(Boolean).join(", ") || t("noAddress")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <GuideEditor propertyId={p.id} guide={g ?? {}} />
          <SourcesPanel
            propertyId={p.id}
            timeZone={p.timezone}
            sources={(sources ?? []) as SourceRow[]}
            conflicts={(conflicts ?? []).map((c) => {
              const r = (Array.isArray(c.reservations) ? c.reservations[0] : c.reservations) as { guest_name: string | null } | null;
              return { source_id: c.source_id, uid: c.uid, conflict: c.conflict as string, feed_start: c.feed_start, feed_end: c.feed_end, reservation_id: c.reservation_id, stay_label: r?.guest_name ?? null };
            })}
          />
          <PlacesManager propertyId={p.id} coords={coords} geoSource={p.geo_source} autoPlaces={p.auto_places} places={places} overpassUrls={process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ["https://overpass-api.de/api/interpreter"]} photonUrl={process.env.PHOTON_URL ?? "https://photon.komoot.io/reverse"} />
        </div>
        <div className="self-start rounded-xl border border-line bg-surface p-5">
          <h2 className="text-[17px] font-semibold">{t("checklist")}</h2>
          {(rooms ?? []).length === 0 ? (
            <p className="mt-2 text-[14px] text-muted">{t("noChecklist")}</p>
          ) : (
            <ul className="mt-2 space-y-2 text-[14px]">
              {(rooms ?? []).map((r) => (
                <li key={r.id}>
                  <span className="font-medium">{r.name}</span>
                  <span className="text-muted"> — {(r.checklist_items as { label: string }[]).map((i) => i.label).join(", ")}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
