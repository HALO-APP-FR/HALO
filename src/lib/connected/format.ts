/**
 * Fenêtre de mission lisible : la date de fin est TOUJOURS affichée quand elle diffère du début
 * (une fenêtre « 8 nov. 11:00 → 11:00 » cachait une fin le 11 nov. — retour du 29/10).
 */
type Style = "full" | "long" | "medium" | "short";
type DateFormatter = { dateTime: (d: Date, o: { dateStyle?: Style; timeStyle?: Style; timeZone?: string }) => string };

/**
 * Règle des fuseaux (retour du 30/10) :
 * - séjours, missions et arrivées : heure LOCALE DU LOGEMENT (properties.timezone), précisée quand elle diffère
 *   du fuseau de l'organisation ;
 * - messages, journaux, historiques : fuseau de l'organisation (Europe/Paris par défaut), partout le même —
 *   jamais celui du navigateur ni du serveur.
 */
export const ORG_TIMEZONE = "Europe/Paris";

export function windowText(f: DateFormatter, start: string, end: string, long = false, timeZone?: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const tz = timeZone ? { timeZone } : {};
  const sameDay = f.dateTime(s, { dateStyle: "short", ...tz }) === f.dateTime(e, { dateStyle: "short", ...tz });
  const startText = f.dateTime(s, { dateStyle: long ? "full" : "medium", timeStyle: "short", ...tz });
  return `${startText} → ${sameDay ? f.dateTime(e, { timeStyle: "short", ...tz }) : f.dateTime(e, { dateStyle: "medium", timeStyle: "short", ...tz })}`;
}

/** Fuseau du logement lisible (« Tokyo, UTC+9 ») quand il diffère de celui de l'organisation, sinon null. */
export function zoneLabel(timeZone: string | null | undefined, at: Date, orgTimeZone = ORG_TIMEZONE): string | null {
  if (!timeZone || timeZone === orgTimeZone) return null;
  try {
    const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
    const city = timeZone.split("/").pop()!.replace(/_/g, " ");
    return `${city}, ${offset.replace("GMT", "UTC")}`;
  } catch {
    return timeZone;
  }
}

/** Durée estimée « 1 h 30 » / « 45 min ». */
export function durationText(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h${m ? ` ${String(m).padStart(2, "0")}` : ""}` : `${m} min`;
}

/**
 * Période d'absence lisible, dans le fuseau de l'organisation (celui du formateur, pas du serveur) :
 * journées entières « 29 oct. → 30 oct. » (fin exclusive à minuit), sinon heures de début et de fin.
 */
export function periodText(f: DateFormatter, start: string, end: string): string {
  const a = new Date(start);
  const b = new Date(end);
  const midnight = (d: Date) => /^0?0[:h.]00/.test(f.dateTime(d, { timeStyle: "short" }));
  if (midnight(a) && midnight(b)) {
    const last = new Date(b.getTime() - 60_000);
    const same = f.dateTime(a, { dateStyle: "short" }) === f.dateTime(last, { dateStyle: "short" });
    return same ? f.dateTime(a, { dateStyle: "full" }) : `${f.dateTime(a, { dateStyle: "medium" })} → ${f.dateTime(last, { dateStyle: "medium" })}`;
  }
  return windowText(f, start, end);
}

/**
 * Minuit (début du jour `date` AAAA-MM-JJ) dans le fuseau `timeZone`, en instant UTC.
 * Sert aux absences « journées entières » : elles suivent le fuseau de l'organisation, pas celui du navigateur
 * ni du serveur (changements d'heure compris).
 */
export function zonedMidnight(date: string, timeZone: string): Date {
  return zonedTime(`${date}T00:00`, timeZone);
}

/** Heure locale « AAAA-MM-JJTHH:mm » saisie pour un lieu donné → instant réel (indépendant du fuseau de l'appareil). */
export function zonedTime(local: string, timeZone: string): Date {
  const [date, time = "00:00"] = local.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, 0);
  const offsetAt = (ms: number) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(ms))
        .map((p) => [p.type, p.value]),
    );
    const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    return asUtc - ms;
  };
  // Deux passes : l'écart du fuseau peut changer autour de minuit lors d'un changement d'heure
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t);
}

/** Jour suivant (AAAA-MM-JJ). */
export function nextDay(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
