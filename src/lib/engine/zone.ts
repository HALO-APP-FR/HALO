/**
 * Centre de zone approximative (identique à public.zone_center en base) : centre de la maille de 0,015° de
 * latitude contenant le point ; largeur en longitude calculée à la latitude du centre de la maille.
 */
export const ZONE_STEP = 0.015;
export function zoneCenter(lat: number, lng: number) {
  const i = Math.floor(lat / ZONE_STEP);
  const latC = (i + 0.5) * ZONE_STEP;
  const lngStep = ZONE_STEP / Math.cos((latC * Math.PI) / 180);
  const j = Math.floor(lng / lngStep);
  return { lat: latC, lng: (j + 0.5) * lngStep };
}
