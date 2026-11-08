import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { AlertTriangle, ChevronDown, MessagesSquare } from "lucide-react";
import { OpenSectionFromHash } from "@/components/connected/open-section";
import { Card } from "@/components/ui/card";
import { windowText } from "@/lib/connected/format";
import { nowDate } from "@/lib/connected/time";
import { cn } from "@/lib/utils";
import { notFound } from "next/navigation";
import { Link, redirect } from "@/i18n/navigation";
import { PageHeader } from "@/components/halo/page-header";
import { GuideEditor } from "@/components/connected/property-forms";
import { getContext, isManagerRole } from "@/lib/connected/context";
import { PlacesManager, type Place } from "@/components/connected/places";
import { SourcesPanel, type SourceRow } from "@/components/connected/sources-panel";
import { distanceM } from "@/lib/engine/places";

/**
 * Section repliable : l'essentiel d'abord (séjours, missions, incidents), les formulaires à la demande.
 * Ouverte directement si l'adresse vise la section (#guide, #sources, #places).
 */
function Section({ id, title, summary, children }: { id: string; title: string; summary: string; children: React.ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-32 rounded-xl border border-line bg-surface" data-testid={`section-${id}`}>
      <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[16px] font-semibold">{title}</span>
          <span className="block text-[13px] text-muted">{summary}</span>
        </span>
        <ChevronDown className="size-5 text-muted transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line p-1 sm:p-2 [&>*]:border-0 [&>*]:shadow-none">{children}</div>
    </details>
  );
}

export default async function PropertyPage({ params }: PageProps<"/[locale]/app/properties/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("connected.properties");
  const { supabase, org } = await getContext();
  if (!org) redirect({ href: "/app", locale });
  if (!isManagerRole(org!.role)) redirect({ href: "/app/missions", locale });
  const [{ data: p }, { data: zoneRow }, { data: g }, { data: rooms }, { data: placeRows }, { data: sources }, { data: conflicts }] = await Promise.all([
    supabase.from("properties").select("id, name, city, address_line, timezone, default_check_in, default_check_out, latitude, longitude, geo_source, auto_places").eq("organization_id", org!.id).eq("id", id).maybeSingle(),
    supabase.from("properties").select("zone_places_at").eq("organization_id", org!.id).eq("id", id).maybeSingle(),
    supabase.from("guest_guides").select("*").eq("organization_id", org!.id).eq("property_id", id).maybeSingle(),
    supabase.from("checklist_rooms").select("id, name, checklist_items(label, photo_required)").eq("organization_id", org!.id).eq("property_id", id).order("sort"),
    supabase.from("property_places").select("*").eq("organization_id", org!.id).eq("property_id", id).order("source").order("name"),
    supabase.from("data_sources").select("id, label, platform, url_hint, status, last_sync_at, last_success_at, last_error, last_counts").eq("organization_id", org!.id).eq("property_id", id).order("created_at"),
    supabase.from("source_events").select("source_id, uid, conflict, feed_start, feed_end, reservation_id, reservations(guest_name, check_in_at), data_sources!inner(property_id)").eq("organization_id", org!.id).eq("state", "conflict").eq("data_sources.property_id", id).limit(50),
  ]);
  if (!p) notFound();
  // Fiche logement centrale : ce qui arrive, ce qui est prévu, ce qui pose problème (mêmes données que les listes)
  const now = nowDate();
  const [{ data: arrivals }, { data: openTasks }, { data: openInc }] = await Promise.all([
    supabase.from("reservations").select("id, guest_name, check_in_at, check_out_at").eq("organization_id", org!.id).eq("property_id", id).eq("status", "confirmed").gte("check_out_at", now.toISOString()).order("check_in_at").limit(3),
    supabase.from("tasks").select("id, type, title, status, window_start, window_end").eq("organization_id", org!.id).eq("property_id", id).in("status", ["unassigned", "assigned", "in_progress", "to_redo", "done"]).order("window_start").limit(6),
    supabase.from("incidents").select("id, description, urgent, status").eq("organization_id", org!.id).eq("property_id", id).neq("status", "resolved").order("urgent", { ascending: false }).order("created_at").limit(5),
  ]);
  const f = await getFormatter();
  const tt = await getTranslations("taskType");
  const tts = await getTranslations("taskStatus");
  const tz = (p.timezone as string | null) ?? undefined;
  // Rubriques du livret réellement remplies (résumé de la section repliée)
  const guideFilled = Object.entries((g ?? {}) as Record<string, unknown>).filter(([k, v]) => !["id", "organization_id", "property_id", "created_at", "updated_at"].includes(k) && typeof v === "string" && v.trim()).length;
  const coords = p.latitude != null && p.longitude != null ? { lat: p.latitude as number, lng: p.longitude as number } : null;
  // Lieux de la zone approximative (voyageurs avant l'ouverture, migration 25) : comptés à part, jamais mélangés
  const zoneCount = (placeRows ?? []).filter((x) => x.scope === "zone" && !x.hidden).length;
  const places: Place[] = (placeRows ?? []).filter((x) => (x.scope ?? "property") === "property").map((x) => ({
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
      <PageHeader
        title={p.name}
        subtitle={[p.address_line, p.city].filter(Boolean).join(", ") || t("noAddress")}
        actions={
          <Link href={`/app/messages?property=${p.id}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-4 text-[14px] font-medium hover:bg-surface-hover" data-testid="property-write">
            <MessagesSquare className="size-4" />
            {t("overview.write")}
          </Link>
        }
      />
      <OpenSectionFromHash />
      <div className="mb-6 grid gap-4 lg:grid-cols-3" data-testid="property-overview">
        <Card className="p-4">
          <h2 className="mb-2 text-[15px] font-semibold">{t("overview.stays")}</h2>
          {(arrivals ?? []).length === 0 && <p className="text-[14px] text-muted">{t("overview.noStay")}</p>}
          <ul className="space-y-1.5 text-[14px]">
            {(arrivals ?? []).map((r) => (
              <li key={r.id}>
                <Link href={`/app/stays/${r.id}`} className="hover:underline">
                  <span className="font-medium">{r.guest_name || "—"}</span> <span className="text-muted">· {windowText(f, r.check_in_at, r.check_out_at, false, tz)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className="p-4">
          <h2 className="mb-2 text-[15px] font-semibold">{t("overview.missions")}</h2>
          {(openTasks ?? []).length === 0 && <p className="text-[14px] text-muted">{t("overview.noMission")}</p>}
          <ul className="space-y-1.5 text-[14px]">
            {(openTasks ?? []).map((k) => (
              <li key={k.id}>
                <Link href={`/app/missions/${k.id}`} className="hover:underline">
                  <span className="font-medium">{(k.title as string) || tt(k.type)}</span> <span className="text-muted">· {tts(k.status)} · {windowText(f, k.window_start, k.window_end, false, tz)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        <Card className={cn("p-4", (openInc ?? []).some((i) => i.urgent) && "border-danger")}>
          <h2 className="mb-2 text-[15px] font-semibold">{t("overview.incidents")}</h2>
          {(openInc ?? []).length === 0 && <p className="text-[14px] text-muted">{t("overview.noIncident")}</p>}
          <ul className="space-y-1.5 text-[14px]">
            {(openInc ?? []).map((i) => (
              <li key={i.id}>
                <Link href={`/app/incidents#incident-${i.id}`} className="flex items-baseline gap-1.5 hover:underline">
                  {i.urgent && <AlertTriangle className="size-3.5 shrink-0 translate-y-0.5 text-danger" aria-label={t("overview.urgent")} />}
                  <span className="line-clamp-2">{i.description}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Section id="guide" title={t("sections.guide")} summary={t("sections.guideSummary", { count: guideFilled })}>
          <GuideEditor propertyId={p.id} guide={g ?? {}} />
          </Section>
          <Section id="sources" title={t("sections.sources")} summary={t("sections.sourcesSummary", { count: (sources ?? []).length })}>
          <SourcesPanel
            propertyId={p.id}
            timeZone={p.timezone}
            sources={(sources ?? []) as SourceRow[]}
            conflicts={(conflicts ?? []).map((c) => {
              const r = (Array.isArray(c.reservations) ? c.reservations[0] : c.reservations) as { guest_name: string | null } | null;
              return { source_id: c.source_id, uid: c.uid, conflict: c.conflict as string, feed_start: c.feed_start, feed_end: c.feed_end, reservation_id: c.reservation_id, stay_label: r?.guest_name ?? null };
            })}
          />
          </Section>
          <Section id="places" title={t("sections.places")} summary={t("sections.placesSummary", { count: places.filter((x) => !x.hidden).length })}>
          {zoneRow && (
            <p className="mb-3 text-[13px] text-muted" data-testid="zone-places-status">
              {zoneRow.zone_places_at ? t("zonePlaces", { count: zoneCount, date: f.dateTime(new Date(zoneRow.zone_places_at as string), { dateStyle: "medium" }) }) : t("zonePlacesPending")}
            </p>
          )}
          <PlacesManager propertyId={p.id} coords={coords} geoSource={p.geo_source} autoPlaces={p.auto_places} places={places} overpassUrls={process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : ["https://overpass-api.de/api/interpreter"]} photonUrl={process.env.PHOTON_URL ?? "https://photon.komoot.io/reverse"} />
          </Section>
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
