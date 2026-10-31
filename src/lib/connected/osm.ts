import "server-only";
/**
 * Fournisseur réel des lieux et de la localisation : OpenStreetMap.
 *  - Nominatim (géocodage de l'adresse du logement) ;
 *  - Overpass (lieux nommés autour du logement).
 * Services publics sans clé, appelés seulement à la demande d'un responsable (jamais par le voyageur),
 * avec un identifiant d'application comme l'exigent leurs règles d'usage. Adresses remplaçables
 * par un service équivalent (NOMINATIM_URL, OVERPASS_URL) pour un usage intensif en production.
 */
import { geoapifyUrl, geocodeQuery, overpassQuery, parseGeoapify, parseOverpass, parsePhoton, photonUrls, PHOTON_URL } from "@/lib/engine/places";

const NOMINATIM = () => process.env.NOMINATIM_URL ?? "https://nominatim.openstreetmap.org/search";
/**
 * Overpass : service public, gratuit, sans clé ; usage raisonnable demandé (~10 000 requêtes/jour,
 * peut répondre 429/504 aux heures chargées). On essaie l'instance principale puis des miroirs publics.
 */
const OVERPASS = () =>
  process.env.OVERPASS_URL
    ? [process.env.OVERPASS_URL]
    : ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"];
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
  const tried: string[] = [];
  // Fournisseur stable recommandé en production (clé gratuite, jamais exigée) : Geoapify, données OpenStreetMap
  const key = process.env.GEOAPIFY_API_KEY;
  if (key) {
    try {
      const res = await fetch(geoapifyUrl(lat, lng, key), { headers: { "User-Agent": headers()["User-Agent"] }, signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (res.ok) return { ok: true as const, source: "geoapify", ...parseGeoapify(await res.json(), lat, lng), dataDate: new Date().toISOString() };
      tried.push(`geoapify:${res.status}`);
    } catch (e) {
      tried.push(`geoapify:${e instanceof Error ? e.name : "error"}`);
    }
  }
  // Photon (OpenStreetMap, sans clé) : une requête par catégorie
  try {
    const responses = await Promise.all(
      photonUrls(lat, lng, process.env.PHOTON_URL ?? PHOTON_URL).map(async ({ category, url }) => {
        const res = await fetch(url, { headers: { "User-Agent": headers()["User-Agent"] }, signal: AbortSignal.timeout(12_000), cache: "no-store" });
        if (!res.ok) throw new Error(`photon:${res.status}`);
        return { category, json: await res.json() };
      }),
    );
    return { ok: true as const, source: "photon.komoot.io", ...parsePhoton(responses, lat, lng) };
  } catch (e) {
    tried.push(e instanceof Error && e.message.startsWith("photon:") ? e.message : `photon:${e instanceof Error ? e.name : "error"}`);
  }
  for (const url of OVERPASS()) {
    try {
      // Requête GET minimale (identifiant d'application seulement) : certaines instances refusent (406)
      // les en-têtes de négociation ajoutés par défaut
      const res = await fetch(`${url}?data=${encodeURIComponent(overpassQuery(lat, lng))}`, {
        headers: { "User-Agent": headers()["User-Agent"], Accept: "*/*" },
        signal: AbortSignal.timeout(15_000),
        cache: "no-store",
      });
      if (!res.ok) {
        tried.push(`${new URL(url).host}:${res.status}`);
        continue;
      }
      return { ok: true as const, source: new URL(url).host, ...parseOverpass(await res.json(), lat, lng) };
    } catch (e) {
      tried.push(`${new URL(url).host}:${e instanceof Error ? e.name : "error"}`);
    }
  }
  return { ok: false as const, error: "provider_unavailable" as OsmError, detail: tried.join(", ") };
}
