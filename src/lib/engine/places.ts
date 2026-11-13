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
  /** Type précis de la source (valeur OpenStreetMap : restaurant, cafe, supermarket, pharmacy…) */
  kind?: string | null;
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

/** Type précis (valeur de l'étiquette OpenStreetMap retenue), dans le même ordre de priorité que la catégorie. */
export function kindOf(tags: Record<string, string>): string | null {
  const order: PlaceCategory[] = ["services", "food", "transport", "activities", "shops"];
  for (const c of order) {
    const r = RULES.find((x) => x.category === c && tags[x.key] && x.values.includes(tags[x.key]));
    if (r) return tags[r.key];
  }
  return null;
}

/**
 * Filtres « envies » du voyageur. Un lieu correspond s'il a l'un des types listés ; un lieu saisi par l'équipe
 * (sans type précis) correspond par sa catégorie quand le filtre en indique une (fallback).
 * Aucun filtre « ouvert maintenant » : HALO ne connaît pas l'ouverture réelle.
 */
export const GUEST_FILTERS = [
  { key: "restaurants", kinds: ["restaurant", "fast_food", "food_court"], fallback: "food" },
  { key: "cafes", kinds: ["cafe", "bar", "pub", "ice_cream"], fallback: null },
  { key: "groceries", kinds: ["supermarket", "convenience", "bakery", "greengrocer", "butcher", "deli", "cheese", "pastry"], fallback: null },
  { key: "shops", kinds: ["wine", "alcohol", "mall", "department_store", "laundry"], fallback: "shops" },
  { key: "activities", kinds: [], fallback: "activities" },
  { key: "transport", kinds: [], fallback: "transport" },
  { key: "pharmacies", kinds: ["pharmacy"], fallback: null },
  { key: "services", kinds: ["hospital", "clinic", "doctors", "atm", "bank", "post_office", "police", "fuel"], fallback: "services" },
] as const;
export type GuestFilter = (typeof GUEST_FILTERS)[number]["key"];

export function matchesFilter(p: { category: string; kind?: string | null }, key: GuestFilter | "all"): boolean {
  if (key === "all") return true;
  const f = GUEST_FILTERS.find((x) => x.key === key)!;
  if (p.kind) return (f.kinds as readonly string[]).includes(p.kind) || (f.kinds.length === 0 && f.fallback === p.category);
  return f.fallback === p.category;
}

/** Rayons proposés (mètres) ; « null » = tous les lieux affichés (3 km au plus, règle de la base). */
export const GUEST_RADII = [500, 1000, 2000, null] as const;

/** Distance connue (après l'ouverture) ou tranche (avant) : le lieu est-il dans le rayon ? Distance inconnue : gardé, signalé. */
export function withinRadius(p: { distance_m?: number | null; distance_band?: number | null }, radius: number | null): boolean {
  if (radius == null) return true;
  if (p.distance_m != null) return p.distance_m <= radius;
  if (p.distance_band != null) return (p.distance_band - 1) * 1000 < radius; // tranche 1 = moins de 1 km…
  return true;
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
      kind: kindOf(tags),
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
    const matched = (p.categories ?? []).find((pc) => GEOAPIFY_CATEGORIES[category].some((g) => pc === g || pc.startsWith(`${g}.`)));
    const kind = matched ? matched.split(".")[1]?.replace(/[^a-z_]/g, "") || null : null;
    all.push({ externalId, category, name: name.slice(0, 160), address: p.address_line2?.slice(0, 300) ?? null, lat: p.lat, lng: p.lon, openingHours: p.opening_hours?.slice(0, 300) ?? null, phone: p.contact?.phone?.slice(0, 40) ?? null, website: p.website?.slice(0, 300) ?? null, distanceM: d, kind: kind === "clinic_or_praxis" ? "clinic" : kind });
  }
  all.sort((a, b) => a.distanceM - b.distanceM);
  return { places: PLACE_CATEGORIES.flatMap((c) => all.filter((x) => x.category === c).slice(0, MAX_PER_CATEGORY)), dataDate: null as string | null };
}

/**
 * Photon (komoot) : recherche OpenStreetMap publique, gratuite, sans clé, rapide et accessible depuis un
 * navigateur. Fournit nom, catégorie, adresse et position (pas d'horaires ni de téléphone : laissés vides).
 * Une requête par catégorie pour que chaque catégorie ait ses lieux les plus proches.
 */
export const PHOTON_URL = "https://photon.komoot.io/reverse";
export function photonUrls(lat: number, lng: number, base = PHOTON_URL, radius = SEARCH_RADIUS_M) {
  return PLACE_CATEGORIES.map((category) => {
    const tags = RULES.filter((r) => r.category === category).flatMap((r) => r.values.map((v) => `osm_tag=${encodeURIComponent(`${r.key}:${v}`)}`));
    return { category, url: `${base}?lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}&radius=${(radius / 1000).toFixed(1)}&limit=${MAX_PER_CATEGORY * 2}&lang=fr&${tags.join("&")}` };
  });
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: { name?: string; osm_type?: string; osm_id?: number; osm_key?: string; osm_value?: string; street?: string; housenumber?: string; postcode?: string; city?: string };
}
/** Réponses Photon (une par catégorie) → lieux dans le rayon, sans doublon, plafonnés par catégorie. */
export function parsePhoton(responses: { category: PlaceCategory; json: { features?: PhotonFeature[] } }[], lat: number, lng: number, radius = SEARCH_RADIUS_M) {
  const seen = new Set<string>();
  const all: ImportedPlace[] = [];
  for (const { json } of responses) {
    for (const f of json.features ?? []) {
      const p = f.properties ?? {};
      const [pLng, pLat] = f.geometry?.coordinates ?? [];
      const name = p.name?.trim();
      const type = p.osm_type === "N" ? "node" : p.osm_type === "W" ? "way" : p.osm_type === "R" ? "relation" : null;
      const category = p.osm_key && p.osm_value ? categoryOf({ [p.osm_key]: p.osm_value }) : null;
      if (!name || !type || !p.osm_id || !category || typeof pLat !== "number" || typeof pLng !== "number") continue;
      const externalId = `${type}/${p.osm_id}`;
      if (seen.has(externalId)) continue;
      seen.add(externalId);
      const d = distanceM(lat, lng, pLat, pLng);
      if (d > radius) continue;
      const street = [p.housenumber, p.street].filter(Boolean).join(" ");
      const city = [p.postcode, p.city].filter(Boolean).join(" ");
      all.push({ externalId, category, name: name.slice(0, 160), address: [street, city].filter(Boolean).join(", ").slice(0, 300) || null, lat: pLat, lng: pLng, openingHours: null, phone: null, website: null, distanceM: d, kind: p.osm_key && p.osm_value ? kindOf({ [p.osm_key]: p.osm_value }) : null });
    }
  }
  all.sort((a, b) => a.distanceM - b.distanceM);
  return { places: PLACE_CATEGORIES.flatMap((c) => all.filter((x) => x.category === c).slice(0, MAX_PER_CATEGORY)), dataDate: null as string | null };
}

/** Nom comparable : minuscules, sans accents, ponctuation ni espaces multiples (« Café de l'Église » = « cafe de l eglise ») */
export function normalizePlaceName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " et ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distance maximale entre deux fiches du même nom pour les considérer comme un seul lieu (entrées multiples, point + bâtiment) */
export const DUPLICATE_RADIUS_M = 80;

type DedupePlace = { id: string; source: string; name: string; lat: number | null; lng: number | null; address?: string | null; opening_hours?: string | null; phone?: string | null; website?: string | null };

/**
 * Doublons visibles par le voyageur : même nom (normalisé) ET même endroit (moins de 80 m, ou même adresse sans
 * coordonnées). Deux établissements de noms différents ne sont JAMAIS fusionnés, même voisins ; deux enseignes
 * identiques éloignées restent distinctes. On garde la fiche la plus fiable : choisie par l'équipe ou le propriétaire,
 * puis celle déjà en favori, puis la plus complète. Renvoie aussi le nombre de fiches regroupées.
 */
export function dedupePlaces<T extends DedupePlace>(places: T[], prefer: ReadonlySet<string> = new Set()): { places: T[]; merged: number } {
  const score = (p: T) =>
    (p.source !== "openstreetmap" ? 100 : 0) + (prefer.has(p.id) ? 50 : 0) + [p.address, p.opening_hours, p.phone, p.website].filter(Boolean).length;
  const same = (a: T, b: T) => {
    if (normalizePlaceName(a.name) !== normalizePlaceName(b.name) || !normalizePlaceName(a.name)) return false;
    if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) return distanceM(a.lat, a.lng, b.lat, b.lng) <= DUPLICATE_RADIUS_M;
    const ad = (x?: string | null) => (x ? normalizePlaceName(x) : "");
    return Boolean(ad(a.address)) && ad(a.address) === ad(b.address);
  };
  const kept: T[] = [];
  let merged = 0;
  // Ordre de préférence d'abord : la meilleure fiche de chaque groupe est rencontrée en premier
  const order = places.map((p, i) => ({ p, i })).sort((x, y) => score(y.p) - score(x.p) || x.i - y.i);
  const keptIdx: number[] = [];
  for (const { p, i } of order) {
    if (kept.some((k) => same(k, p))) {
      merged++;
      continue;
    }
    kept.push(p);
    keptIdx.push(i);
  }
  // Ordre d'origine conservé pour l'affichage
  return { places: kept.map((p, j) => ({ p, i: keptIdx[j] })).sort((a, b) => a.i - b.i).map((x) => x.p), merged };
}
