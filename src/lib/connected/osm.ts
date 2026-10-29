import "server-only";
/**
 * Fournisseur réel des lieux et de la localisation : OpenStreetMap.
 *  - Nominatim (géocodage de l'adresse du logement) ;
 *  - Overpass (lieux nommés autour du logement).
 * Services publics sans clé, appelés seulement à la demande d'un responsable (jamais par le voyageur),
 * avec un identifiant d'application comme l'exigent leurs règles d'usage. Adresses remplaçables
 * par un service équivalent (NOMINATIM_URL, OVERPASS_URL) pour un usage intensif en production.
 */
import { geocodeQuery, overpassQuery, parseOverpass } from "@/lib/engine/places";

const NOMINATIM = () => process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org/search";
const OVERPASS = () => process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";
const appUrl = () => process.env.APP_URL ?? (process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : "https://halo.app");
const headers = () => ({ "User-Agent": `HALO/1.0 (${appUrl()})`, Referer: appUrl(), "Accept-Language": "fr,en" });

export type OsmError = "no_address" | "not_found" | "provider_unavailable";

export async function geocode(p: { addressLine?: string | null; postalCode?: string | null; city?: string | null; countryCode?: string | null }): Promise<{ ok: true; lat: number; lng: number; label: string } | { ok: false; error: OsmError }> {
  const q = geocodeQuery(p);
  if (!q) return { ok: false, error: "no_address" };
  const url = `${NOMINATIM()}?format=jsonv2&limit=1&addressdetails=0&q=${encodeURIComponent(q)}${p.countryCode ? `&countrycodes=${encodeURIComponent(p.countryCode.toLowerCase())}` : ""}`;
  try {
    const res = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (!res.ok) return { ok: false, error: "provider_unavailable" };
    const list = (await res.json()) as { lat: string; lon: string; display_name: string }[];
    if (!list.length) return { ok: false, error: "not_found" };
    return { ok: true, lat: Number(list[0].lat), lng: Number(list[0].lon), label: list[0].display_name };
  } catch {
    return { ok: false, error: "provider_unavailable" };
  }
}

export async function nearbyPlaces(lat: number, lng: number) {
  try {
    const res = await fetch(OVERPASS(), {
      method: "POST",
      headers: { ...headers(), "Content-Type": "application/x-www-form-urlencoded" },
      body: `data=${encodeURIComponent(overpassQuery(lat, lng))}`,
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
    });
    if (!res.ok) return { ok: false as const, error: "provider_unavailable" as OsmError };
    return { ok: true as const, ...parseOverpass(await res.json(), lat, lng) };
  } catch {
    return { ok: false as const, error: "provider_unavailable" as OsmError };
  }
}
