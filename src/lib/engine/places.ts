/**
 * Lieux autour d'un logement — fonctions PURES (aucun appel réseau ici).
 * Source réelle : OpenStreetMap (requête Overpass), données reprises telles quelles :
 * aucun lieu, horaire, avis ou disponibilité n'est inventé ; ce qui manque reste vide.
 */
export type PlaceCategory = "food" | "shops" | "transport" | "activities" | "services";
export const PLACE_CATEGORIES: PlaceCategory[] = ["food", "shops", "transport", "activities", "services"];

/** Rayon de recherche autour du logement (mètres) et nombre maximal de lieux par catégorie. */
export const SEARCH_RADIUS_M = 1200;
export const MAX_PER_CATEGORY = 15;

export interface ImportedPlace {
  externalId: string;
  category: PlaceCategory;
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  openingHours: string | null;
  phone: string | null;
  website: string | null;
  distanceM: number;
}

const RULES: { category: PlaceCategory; key: string; values: string[] }[] = [
  { category: "food", key: "amenity", values: ["restaurant", "cafe", "bar", "pub", "fast_food", "ice_cream", "food_court"] },
  { category: "shops", key: "shop", values: ["supermarket", "convenience", "bakery", "greengrocer", "butcher", "deli", "wine", "alcohol", "cheese", "pastry", "mall", "department_store", "laundry"] },
  { category: "transport", key: "railway", values: ["station", "halt", "tram_stop"] },
  { category: "transport", key: "amenity", values: ["bus_station", "taxi", "bicycle_rental", "car_rental", "ferry_terminal", "charging_station"] },
  { category: "transport", key: "highway", values: ["bus_stop"] },
  { category: "activities", key: "tourism", values: ["museum", "attraction", "viewpoint", "gallery", "zoo", "aquarium", "theme_park"] },
  { category: "activities", key: "leisure", values: ["park", "garden", "beach_resort", "sports_centre", "swimming_pool", "marina"] },
  { category: "activities", key: "amenity", values: ["cinema", "theatre", "arts_centre"] },
  { category: "services", key: "amenity", values: ["pharmacy", "hospital", "clinic", "doctors", "atm", "bank", "post_office", "police", "fuel"] },
];

/** Requête Overpass (lieux nommés uniquement) dans le rayon du logement. */
export function overpassQuery(lat: number, lng: number, radius = SEARCH_RADIUS_M): string {
  const around = `(around:${radius},${lat.toFixed(6)},${lng.toFixed(6)})`;
  const parts = RULES.map((r) => `nwr${around}["${r.key}"~"^(${r.values.join("|")})$"]["name"];`);
  return `[out:json][timeout:25];(${parts.join("")});out center tags 400;`;
}

export function distanceM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return Math.round(2 * 6371000 * Math.asin(Math.sqrt(a)));
}

function categoryOf(tags: Record<string, string>): PlaceCategory | null {
  // Les services utiles (pharmacie, hôpital…) priment sur les autres règles « amenity »
  const order: PlaceCategory[] = ["services", "food", "transport", "activities", "shops"];
  for (const c of order) {
    if (RULES.some((r) => r.category === c && tags[r.key] && r.values.includes(tags[r.key]))) return c;
  }
  return null;
}

function addressOf(tags: Record<string, string>): string | null {
  const street = [tags["addr:housenumber"], tags["addr:street"]].filter(Boolean).join(" ");
  const city = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ");
  const full = [street, city].filter(Boolean).join(", ");
  return full || null;
}

interface OverpassElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** Réponse Overpass → lieux, dans le rayon, les plus proches d'abord, plafonnés par catégorie. */
export function parseOverpass(json: { elements?: OverpassElement[]; osm3s?: { timestamp_osm_base?: string } }, lat: number, lng: number, radius = SEARCH_RADIUS_M) {
  const seen = new Set<string>();
  const all: ImportedPlace[] = [];
  for (const el of json.elements ?? []) {
    const tags = el.tags ?? {};
    const pLat = el.lat ?? el.center?.lat;
    const pLng = el.lon ?? el.center?.lon;
    const name = tags.name?.trim();
    const category = categoryOf(tags);
    if (!name || !category || typeof pLat !== "number" || typeof pLng !== "number") continue;
    const externalId = `${el.type}/${el.id}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const d = distanceM(lat, lng, pLat, pLng);
    if (d > radius) continue; // hors du périmètre du logement : jamais affiché
    all.push({
      externalId,
      category,
      name: name.slice(0, 160),
      address: addressOf(tags)?.slice(0, 300) ?? null,
      lat: pLat,
      lng: pLng,
      openingHours: tags.opening_hours?.slice(0, 300) ?? null,
      phone: (tags.phone ?? tags["contact:phone"])?.slice(0, 40) ?? null,
      website: (tags.website ?? tags["contact:website"])?.slice(0, 300) ?? null,
      distanceM: d,
    });
  }
  all.sort((a, b) => a.distanceM - b.distanceM);
  const places = PLACE_CATEGORIES.flatMap((c) => all.filter((p) => p.category === c).slice(0, MAX_PER_CATEGORY));
  const ts = json.osm3s?.timestamp_osm_base;
  return { places, dataDate: ts && !Number.isNaN(new Date(ts).getTime()) ? new Date(ts).toISOString() : null };
}

/** Adresse postale à géocoder (aucun pays imposé : celui du logement). */
export function geocodeQuery(p: { addressLine?: string | null; postalCode?: string | null; city?: string | null }) {
  return [p.addressLine, [p.postalCode, p.city].filter(Boolean).join(" ")].filter((x) => x && x.trim()).join(", ");
}

/**
 * Geoapify Places (données OpenStreetMap servies par une API stable, clé gratuite jusqu'à 3 000 requêtes/jour).
 * Utilisé seulement si GEOAPIFY_API_KEY est configurée ; sinon Overpass public.
 */
export const GEOAPIFY_CATEGORIES: Record<PlaceCategory, string[]> = {
  food: ["catering.restaurant", "catering.cafe", "catering.bar", "catering.pub", "catering.fast_food", "catering.ice_cream"],
  shops: ["commercial.supermarket", "commercial.convenience", "commercial.food_and_drink", "commercial.marketplace", "commercial.shopping_mall"],
  transport: ["public_transport", "rental.bicycle", "rental.car"],
  activities: ["tourism.attraction", "tourism.sights", "entertainment", "leisure.park", "beach"],
  services: ["healthcare.pharmacy", "healthcare.hospital", "healthcare.clinic_or_praxis", "service.financial.atm", "service.post", "service.police"],
};

export function geoapifyUrl(lat: number, lng: number, key: string, radius = SEARCH_RADIUS_M) {
  const cats = Object.values(GEOAPIFY_CATEGORIES).flat().join(",");
  return `https://api.geoapify.com/v2/places?categories=${cats}&filter=circle:${lng.toFixed(6)},${lat.toFixed(6)},${radius}&bias=proximity:${lng.toFixed(6)},${lat.toFixed(6)}&limit=200&apiKey=${encodeURIComponent(key)}`;
}

interface GeoapifyFeature {
  properties: { place_id?: string; name?: string; categories?: string[]; lat: number; lon: number; address_line2?: string; opening_hours?: string; contact?: { phone?: string }; website?: string; datasource?: { raw?: { osm_id?: number; osm_type?: string } } };
}
export function parseGeoapify(json: { features?: GeoapifyFeature[] }, lat: number, lng: number, radius = SEARCH_RADIUS_M) {
  const all: ImportedPlace[] = [];
  const seen = new Set<string>();
  for (const f of json.features ?? []) {
    const p = f.properties;
    const name = p.name?.trim();
    const category = (Object.keys(GEOAPIFY_CATEGORIES) as PlaceCategory[]).find((c) => (p.categories ?? []).some((pc) => GEOAPIFY_CATEGORIES[c].some((g) => pc === g || pc.startsWith(`${g}.`))));
    if (!name || !category || typeof p.lat !== "number" || typeof p.lon !== "number") continue;
    const raw = p.datasource?.raw;
    const externalId = raw?.osm_id ? `${raw.osm_type === "w" ? "way" : raw.osm_type === "r" ? "relation" : "node"}/${raw.osm_id}` : `geoapify/${p.place_id ?? `${p.lat},${p.lon}`}`;
    if (seen.has(externalId)) continue;
    seen.add(externalId);
    const d = distanceM(lat, lng, p.lat, p.lon);
    if (d > radius) continue;
    all.push({ externalId, category, name: name.slice(0, 160), address: p.address_line2?.slice(0, 300) ?? null, lat: p.lat, lng: p.lon, openingHours: p.opening_hours?.slice(0, 300) ?? null, phone: p.contact?.phone?.slice(0, 40) ?? null, website: p.website?.slice(0, 300) ?? null, distanceM: d });
  }
  all.sort((a, b) => a.distanceM - b.distanceM);
  return { places: PLACE_CATEGORIES.flatMap((c) => all.filter((x) => x.category === c).slice(0, MAX_PER_CATEGORY)), dataDate: null as string | null };
}
