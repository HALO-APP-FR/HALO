/** Pays et fuseaux horaires (noms affichés dans la langue de l'utilisateur via Intl). */

export const COUNTRY_CODES =
  "FR BE CH LU MC ES PT IT DE AT NL GB IE DK SE NO FI IS PL CZ SK HU RO BG GR HR SI MT CY EE LV LT US CA MX BR AR CL CO PE UY MA TN DZ SN CI ZA EG AE SA QA TR IL JP KR CN HK SG TH VN ID MY PH IN AU NZ MU RE GP MQ PF NC".split(" ");

/** Fuseau par défaut d'un pays (le plus courant). */
export const COUNTRY_TZ: Record<string, string> = {
  FR: "Europe/Paris", BE: "Europe/Brussels", CH: "Europe/Zurich", LU: "Europe/Luxembourg", MC: "Europe/Monaco",
  ES: "Europe/Madrid", PT: "Europe/Lisbon", IT: "Europe/Rome", DE: "Europe/Berlin", AT: "Europe/Vienna",
  NL: "Europe/Amsterdam", GB: "Europe/London", IE: "Europe/Dublin", DK: "Europe/Copenhagen", SE: "Europe/Stockholm",
  NO: "Europe/Oslo", FI: "Europe/Helsinki", IS: "Atlantic/Reykjavik", PL: "Europe/Warsaw", CZ: "Europe/Prague",
  SK: "Europe/Bratislava", HU: "Europe/Budapest", RO: "Europe/Bucharest", BG: "Europe/Sofia", GR: "Europe/Athens",
  HR: "Europe/Zagreb", SI: "Europe/Ljubljana", MT: "Europe/Malta", CY: "Asia/Nicosia", EE: "Europe/Tallinn",
  LV: "Europe/Riga", LT: "Europe/Vilnius", US: "America/New_York", CA: "America/Toronto", MX: "America/Mexico_City",
  BR: "America/Sao_Paulo", AR: "America/Argentina/Buenos_Aires", CL: "America/Santiago", CO: "America/Bogota",
  PE: "America/Lima", UY: "America/Montevideo", MA: "Africa/Casablanca", TN: "Africa/Tunis", DZ: "Africa/Algiers",
  SN: "Africa/Dakar", CI: "Africa/Abidjan", ZA: "Africa/Johannesburg", EG: "Africa/Cairo", AE: "Asia/Dubai",
  SA: "Asia/Riyadh", QA: "Asia/Qatar", TR: "Europe/Istanbul", IL: "Asia/Jerusalem", JP: "Asia/Tokyo", KR: "Asia/Seoul",
  CN: "Asia/Shanghai", HK: "Asia/Hong_Kong", SG: "Asia/Singapore", TH: "Asia/Bangkok", VN: "Asia/Ho_Chi_Minh",
  ID: "Asia/Makassar", MY: "Asia/Kuala_Lumpur", PH: "Asia/Manila", IN: "Asia/Kolkata", AU: "Australia/Sydney",
  NZ: "Pacific/Auckland", MU: "Indian/Mauritius", RE: "Indian/Reunion", GP: "America/Guadeloupe",
  MQ: "America/Martinique", PF: "Pacific/Tahiti", NC: "Pacific/Noumea",
};

export function countryName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function sortedCountries(locale: string) {
  return COUNTRY_CODES.map((code) => ({ code, name: countryName(code, locale) })).sort((a, b) =>
    a.name.localeCompare(b.name, locale),
  );
}

export function allTimezones(): string[] {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return Object.values(COUNTRY_TZ);
  }
}

/** « Europe/Paris (UTC+1) » */
export function timezoneLabel(tz: string, locale: string) {
  try {
    const offset = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    return `${tz.replace(/_/g, " ")}${offset ? ` (${offset})` : ""}`;
  } catch {
    return tz;
  }
}
