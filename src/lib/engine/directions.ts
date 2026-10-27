/**
 * Liens d'itinéraire vers Apple Plans, Google Maps et Waze.
 * Aucune clé, aucun appel serveur, aucune localisation de l'utilisateur :
 * le téléphone ouvre l'application choisie avec la destination.
 */
export type MapsApp = "apple" | "google" | "waze";
export const MAPS_APPS: MapsApp[] = ["apple", "google", "waze"];

export interface Destination {
  name: string;
  addressLine?: string;
  postalCode?: string;
  city?: string;
  countryCode?: string;
  lat?: number;
  lng?: number;
}

const validCoord = (lat?: number, lng?: number) =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

/** Texte d'adresse le plus précis disponible ; `precise` = rue connue ou coordonnées. */
export function destinationQuery(d: Destination) {
  const street = d.addressLine?.trim();
  const parts = [street, [d.postalCode?.trim(), d.city?.trim()].filter(Boolean).join(" ")].filter(Boolean);
  const coords = validCoord(d.lat, d.lng);
  // Adresse incomplète : on retombe sur « nom du logement, ville » (approximatif)
  const text = street ? parts.join(", ") : [d.name, d.city?.trim()].filter(Boolean).join(", ");
  return { text, coords: coords ? `${d.lat!.toFixed(6)},${d.lng!.toFixed(6)}` : undefined, precise: coords || !!street };
}

export function directionsLink(app: MapsApp, d: Destination) {
  const q = destinationQuery(d);
  const enc = encodeURIComponent;
  switch (app) {
    case "google":
      return `https://www.google.com/maps/dir/?api=1&destination=${enc(q.coords ?? q.text)}`;
    case "apple":
      // Plans sur iPhone, iPad et Mac ; version web ailleurs
      return `https://maps.apple.com/?daddr=${enc(q.coords ?? q.text)}${q.coords ? `&q=${enc(d.name)}` : ""}`;
    case "waze":
      // Waze interprète mieux les coordonnées ; à défaut, recherche par adresse
      return q.coords ? `https://waze.com/ul?ll=${enc(q.coords)}&navigate=yes` : `https://waze.com/ul?q=${enc(q.text)}&navigate=yes`;
  }
}
