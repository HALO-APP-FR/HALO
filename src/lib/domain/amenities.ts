/**
 * Catalogue des équipements et extérieurs. Libellés traduits : amenity.<clé>, amenityGroup.<groupe>.
 * Sert au listing par logement, au livret voyageur et à la localisation des signalements.
 */
export const AMENITY_GROUPS = [
  { group: "outdoor", keys: ["terrace", "balcony", "garden", "pool", "hot_tub", "bbq", "outdoor_furniture", "parking", "garage", "ev_charger"] },
  { group: "kitchen", keys: ["oven", "microwave", "hob", "fridge", "freezer", "dishwasher", "coffee_machine", "kettle", "toaster", "cookware"] },
  { group: "appliances", keys: ["washing_machine", "dryer", "iron", "vacuum", "hair_dryer"] },
  { group: "comfort", keys: ["wifi", "tv", "air_conditioning", "heating", "fireplace", "fan", "workspace", "elevator"] },
  { group: "family", keys: ["baby_cot", "high_chair", "baby_bath", "safety_gates"] },
  { group: "safety", keys: ["smoke_detector", "co_detector", "fire_extinguisher", "first_aid_kit", "safe"] },
] as const;

export type AmenityKey = (typeof AMENITY_GROUPS)[number]["keys"][number];

export const ALL_AMENITIES: string[] = AMENITY_GROUPS.flatMap((g) => [...g.keys]);

/** Équipements « extérieurs » mis en avant sur la fiche et dans le livret. */
export const OUTDOOR_AMENITIES = new Set<string>(AMENITY_GROUPS[0].keys);

export const isCatalogAmenity = (key: string) => ALL_AMENITIES.includes(key);
