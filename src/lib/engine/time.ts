/**
 * Utilitaires de temps — règle d'or : tout est stocké en UTC,
 * tout est affiché dans le fuseau du LOGEMENT (jamais celui du navigateur).
 */

/** Renvoie la date calendaire locale (AAAA-MM-JJ) d'un instant dans un fuseau donné. */
export function localDateKey(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Deux instants tombent-ils le même jour calendaire dans le fuseau du logement ? */
export function isSameLocalDay(a: Date, b: Date, timeZone: string): boolean {
  return localDateKey(a, timeZone) === localDateKey(b, timeZone);
}

/** Heure locale formatée selon la langue (24 h ou 12 h selon l'usage de la langue). */
export function formatLocalTime(instant: Date, timeZone: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/**
 * Plage horaire à l'heure locale du logement : « 11:00 → 16:00 » le même jour,
 * « 11:00 → mer. 28 16:00 » quand la fin tombe un autre jour (fenêtre qui traverse minuit).
 * Seule source de formatage des fenêtres de mission : liste, fiche, planning et accueil l'utilisent.
 */
export function formatLocalRange(start: Date, end: Date, timeZone: string, locale: string, referenceDayKey?: string): string {
  const day = (d: Date) => new Intl.DateTimeFormat(locale, { timeZone, weekday: "short", day: "numeric" }).format(d);
  // Début daté s'il ne tombe pas le jour affiché (fenêtre ouverte depuis la veille, par exemple)
  const from = referenceDayKey && localDateKey(start, timeZone) !== referenceDayKey ? `${day(start)} ${formatLocalTime(start, timeZone, locale)}` : formatLocalTime(start, timeZone, locale);
  const to = formatLocalTime(end, timeZone, locale);
  if (isSameLocalDay(start, end, timeZone)) return `${from} → ${to}`;
  return `${from} → ${day(end)} ${to}`;
}

/** Durée en minutes entre deux instants (arrondie à la minute inférieure). */
export function minutesBetween(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60_000);
}

export type WindowUrgency = "normal" | "high" | "urgent";

/**
 * Priorité d'une rotation :
 * - urgent : la fenêtre est plus courte que la durée de ménage prévue ;
 * - high : départ et arrivée le même jour calendaire local (rotation à J) ;
 * - normal sinon.
 */
export function turnoverPriority(params: {
  checkOutAt: Date;
  nextCheckInAt: Date | null;
  cleaningDurationMin: number;
  timeZone: string;
}): WindowUrgency {
  const { checkOutAt, nextCheckInAt, cleaningDurationMin, timeZone } = params;
  if (!nextCheckInAt) return "normal";
  if (minutesBetween(checkOutAt, nextCheckInAt) < cleaningDurationMin) return "urgent";
  if (isSameLocalDay(checkOutAt, nextCheckInAt, timeZone)) return "high";
  return "normal";
}

/** Décalage (en minutes) du fuseau par rapport à UTC à un instant donné (gère l'heure d'été). */
export function timeZoneOffsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/**
 * Convertit une date + heure « murale » d'un logement en instant UTC.
 * Ex : ("2026-07-14", "11:00", "Europe/Paris") → 2026-07-14T09:00:00Z
 */
export function zonedTimeToUtc(dateKey: string, time: string, timeZone: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const wallAsUtc = Date.UTC(y, m - 1, d, hh, mm);
  let offset = timeZoneOffsetMinutes(new Date(wallAsUtc), timeZone);
  let result = wallAsUtc - offset * 60_000;
  // Deuxième passe : corrige les cas où le décalage change entre les deux instants (heure d'été)
  const offset2 = timeZoneOffsetMinutes(new Date(result), timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    result = wallAsUtc - offset * 60_000;
  }
  return new Date(result);
}

/** Minutes écoulées depuis minuit, à l'heure locale du logement. */
export function localMinutesOfDay(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return get("hour") * 60 + get("minute");
}

/** Ajoute n jours à une clé de date AAAA-MM-JJ. */
export function addDaysToKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}
