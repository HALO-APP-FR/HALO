/**
 * Protection de l'adresse avant l'ouverture des informations pratiques (miroir de la migration 27 :
 * public.guest_text_safe, public.street_of, public.guest_pick_before_access). La base décide ; ce module sert à
 * PRÉVENIR l'équipe, dans la fiche du logement, de ce que le voyageur verra réellement avant l'ouverture.
 */
import { distanceM } from "./places";

/** Formulations qui situent le logement (« en bas de l'immeuble », « à 50 m », « next door »…). Même liste qu'en base. */
export const REVEALS_HOME =
  /(en bas|au pied|juste à côté|à côté (du|de l|de la|des)|en face|même (rue|immeuble|bâtiment|résidence)|notre (rue|immeuble|résidence|porte|bâtiment|cour)|immeuble|résidence|rez-de-chaussée|(^|[^\p{L}])étage|voisin|du logement|de l'appartement|de la maison|depuis le logement|downstairs|next door|across the street|same (street|building)|our (street|building)|from the (flat|apartment|house)|(^|[^\p{L}\d])\d+ ?(m|mètres|metres|meters)(?![\p{L}])|(^|[^\p{L}\d])\d+ ?min(utes)? (à pied|walk))/iu;

export const revealsHome = (text: string | null | undefined) => !!text && REVEALS_HOME.test(text);

/** Rue d'une adresse, sans numéro (« 8 bis rue des Tests, Paris » → « rue des tests »). */
export function streetOf(address: string | null | undefined): string | null {
  const first = (address ?? "").split(",")[0] ?? "";
  const s = first.replace(/^\s*\d+\s*(bis|ter|b)?\s*,?\s*/i, "").trim().toLowerCase();
  return s || null;
}

export const NEAR_HOME_M = 200;

export type BeforeAccess =
  /** Choisie « après l'ouverture » (par défaut) */
  | "access"
  /** Visible dès la réservation, listée sans point sur la carte */
  | "booking"
  /** Choisie « dès la réservation » mais retenue automatiquement : moins de 200 m du logement */
  | "near"
  /** … ou dans la même rue que le logement */
  | "same_street";

/** Ce que le voyageur verra de cette recommandation avant l'ouverture. */
export function beforeAccess(
  place: { guest_visibility?: string | null; lat: number | null; lng: number | null; address: string | null },
  home: { lat: number | null; lng: number | null; address: string | null },
): BeforeAccess {
  if (place.guest_visibility !== "booking") return "access";
  if (place.lat != null && place.lng != null && home.lat != null && home.lng != null && distanceM(home.lat, home.lng, place.lat, place.lng) < NEAR_HOME_M) return "near";
  const street = streetOf(home.address);
  if (street && street.length >= 4 && (place.address ?? "").toLowerCase().includes(street)) return "same_street";
  return "booking";
}
