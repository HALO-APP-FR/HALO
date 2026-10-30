import { getTranslations, setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { GuideEditor } from "@/components/connected/property-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { PlacesManager, type Place } from "@/components/connected/places";
import { distanceM } from "@/lib/engine/places";

export default async function PropertyPage({ params }: PageProps<"/[locale]/app/properties/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.properties");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const [{ data: p }, { data: g }, { data: rooms }, { data: placeRows }] = await Promise.all([
    supabase.from("properties").select("id, name, city, address_line, default_check_in, default_check_out, latitude, longitude, geo_source, auto_places").eq("organization_id", org!.id).eq("id", id).maybeSingle(),
    supabase.from("guest_guides").select("*").eq("organization_id", org!.id).eq("property_id", id).maybeSingle(),
    supabase.from("checklist_rooms").select("id, name, checklist_items(label, photo_required)").eq("organization_id", org!.id).eq("property_id", id).order("sort"),
    supabase.from("property_places").select("*").eq("organization_id", org!.id).eq("property_id", id).order("source").order("name"),
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
    distance_m: coords && x.latitude != null ? distanceM(coords.lat, coords.lng, x.latitude, x.longitude) : null,
  }));
  return (
    <>
      <PageHeader title={p.name} subtitle={[p.address_line, p.city].filter(Boolean).join(", ") || t("noAddress")} />
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <GuideEditor propertyId={p.id} guide={g ?? {}} />
          <PlacesManager propertyId={p.id} coords={coords} geoSource={p.geo_source} autoPlaces={p.auto_places} places={places} />
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
