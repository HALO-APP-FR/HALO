import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { zoneCenter } from "@/lib/engine/zone";

/**
 * Lieux de la ZONE approximative d'un logement (avant l'ouverture des informations pratiques).
 * Récupérés autour du centre de zone — jamais autour du logement — pour que ni la sélection des lieux
 * ni les distances ne trahissent le point exact. Clé serveur uniquement ; une tentative au plus par minute (une réponse en échec n'empêche pas la suivante longtemps).
 */
export async function ensureZonePlaces(propertyId: string, force = false): Promise<{ ok: boolean; count?: number; error?: string }> {
  const admin = supabaseAdmin();
  if (!admin) return { ok: false, error: "no_server_key" };
  const { data: p, error } = await admin.from("properties").select("id, organization_id, latitude, longitude, auto_places, zone_places_at, zone_places_try_at").eq("id", propertyId).maybeSingle();
  if (error || !p) return { ok: false, error: error?.code === "42703" ? "migration_missing" : "not_found" };
  if (p.latitude == null || p.longitude == null || !p.auto_places) return { ok: false, error: "not_applicable" };
  const fresh = p.zone_places_at && Date.now() - Date.parse(p.zone_places_at) < 30 * 86_400_000;
  const tried = p.zone_places_try_at && Date.now() - Date.parse(p.zone_places_try_at) < 60_000;
  if (!force && (fresh || tried)) return { ok: true };
  await admin.from("properties").update({ zone_places_try_at: new Date().toISOString() }).eq("id", p.id);
  const c = zoneCenter(p.latitude, p.longitude);
  const { nearbyPlaces } = await import("./osm");
  const r = await nearbyPlaces(c.lat, c.lng);
  if (!r.ok) {
    console.warn(`[zone-places] ${p.id} : ${r.error} ${"detail" in r ? r.detail : ""}`);
    return { ok: false, error: r.error };
  }
  const date = r.dataDate ?? new Date().toISOString();
  const rows = r.places.map((x) => ({
    organization_id: p.organization_id,
    property_id: p.id,
    scope: "zone",
    source: "openstreetmap",
    external_id: x.externalId,
    category: x.category,
    name: x.name,
    address: x.address,
    latitude: x.lat,
    longitude: x.lng,
    opening_hours: x.openingHours,
    phone: x.phone,
    website: x.website,
    source_updated_at: date,
    kind: x.kind && /^[a-z_]{1,40}$/.test(x.kind) ? x.kind : null,
  }));
  if (rows.length) {
    const { error: ue } = await admin.from("property_places").upsert(rows, { onConflict: "property_id,scope,source,external_id" });
    if (ue) return { ok: false, error: ue.code ?? "db" };
    const covered = "covered" in r && Array.isArray(r.covered) ? (r.covered as string[]) : null;
    let del = admin.from("property_places").delete().eq("property_id", p.id).eq("scope", "zone").eq("hidden", false);
    if (covered) del = del.in("category", covered);
    await del.not("external_id", "in", `(${rows.map((x) => `"${x.external_id}"`).join(",")})`);
  }
  await admin.from("properties").update({ zone_places_at: new Date().toISOString() }).eq("id", p.id);
  return { ok: true, count: rows.length };
}

/** Depuis un lien voyageur : retrouve le logement côté serveur (empreinte du lien, comme la base). */
export async function ensureZonePlacesForToken(token: string) {
  const admin = supabaseAdmin();
  if (!admin || !/^[A-Za-z0-9_-]{20,200}$/.test(token)) return;
  const hash = createHash("sha256").update(token).digest("hex");
  const { data: l } = await admin.from("guest_links").select("reservation_id, revoked_at").eq("token_hash", hash).maybeSingle();
  if (!l || l.revoked_at) return;
  const { data: r } = await admin.from("reservations").select("property_id").eq("id", l.reservation_id).maybeSingle();
  if (r) await ensureZonePlaces(r.property_id as string);
}
