/**
 * Import de données (logements, équipe, séjours) — fonctions PURES, testées.
 * Lecture CSV, correspondance automatique des colonnes, normalisation et contrôle de chaque ligne.
 * Rien n'est inventé : une valeur non reconnue est signalée, jamais devinée en silence.
 */
export type ImportKind = "properties" | "team" | "stays";
export const IMPORT_KINDS: ImportKind[] = ["properties", "team", "stays"];
export const MAX_IMPORT_ROWS = 2000;

export const FIELDS: Record<ImportKind, { key: string; required?: boolean }[]> = {
  properties: [
    { key: "name", required: true },
    { key: "address" },
    { key: "postal_code" },
    { key: "city" },
    { key: "country" },
    { key: "timezone" },
    { key: "capacity" },
    { key: "check_in_time" },
    { key: "check_out_time" },
    { key: "cleaning_minutes" },
    { key: "instructions" },
    { key: "external_ref" },
  ],
  team: [{ key: "first_name" }, { key: "last_name" }, { key: "full_name" }, { key: "email" }, { key: "phone" }, { key: "role" }, { key: "position" }, { key: "worker_type" }],
  stays: [
    { key: "property", required: true },
    { key: "check_in", required: true },
    { key: "check_out", required: true },
    { key: "check_in_time" },
    { key: "check_out_time" },
    { key: "guest_name" },
    { key: "guests" },
    { key: "adults" },
    { key: "children" },
    { key: "babies" },
    { key: "source" },
    { key: "external_ref" },
    { key: "status" },
    { key: "guest_email" },
    { key: "notes" },
  ],
};

/** Libellés courants (FR / EN, exports Airbnb, Booking, PMS) → champ HALO. Comparaison sans accents ni ponctuation. */
const SYNONYMS: Record<ImportKind, Record<string, string[]>> = {
  properties: {
    name: ["nom", "name", "logement", "nomdulogement", "property", "propertyname", "listing", "listingname", "annonce", "bien", "titre", "title"],
    address: ["adresse", "address", "rue", "street", "adresse1", "addressline", "addressline1"],
    postal_code: ["codepostal", "cp", "postalcode", "zip", "zipcode", "postcode"],
    city: ["ville", "city", "commune", "localite", "town"],
    country: ["pays", "country", "countrycode", "codepays"],
    timezone: ["fuseau", "fuseauhoraire", "timezone", "tz"],
    capacity: ["capacite", "capacity", "voyageursmax", "maxguests", "personnes", "couchages", "accommodates"],
    check_in_time: ["heurearrivee", "checkintime", "arrivee", "checkin", "heuredarrivee"],
    check_out_time: ["heuredepart", "checkouttime", "depart", "checkout", "heurededepart"],
    cleaning_minutes: ["dureemenage", "menage", "dureedumenage", "cleaningduration", "cleaningminutes", "cleaningtime"],
    instructions: ["consignes", "instructions", "notes", "remarques", "informations"],
    external_ref: ["reference", "ref", "id", "identifiant", "listingid", "propertyid", "externalid", "code"],
  },
  team: {
    first_name: ["prenom", "firstname", "givenname"],
    last_name: ["nom", "lastname", "surname", "familyname", "nomdefamille"],
    full_name: ["nomcomplet", "fullname", "name", "intervenant", "membre"],
    email: ["email", "mail", "courriel", "adresseemail", "emailprofessionnel", "emailpro"],
    phone: ["telephone", "tel", "phone", "mobile", "portable", "telephoneprofessionnel"],
    role: ["role", "fonctionhalo", "acces", "access"],
    position: ["poste", "position", "metier", "job", "fonction"],
    worker_type: ["statut", "contrat", "type", "workertype", "salarieouprestataire"],
  },
  stays: {
    property: ["logement", "property", "listing", "annonce", "bien", "nomdulogement", "propertyname", "listingname", "hebergement", "unit"],
    check_in: ["arrivee", "checkin", "datearrivee", "datedarrivee", "startdate", "debut", "du", "from", "arrival"],
    check_out: ["depart", "checkout", "datedepart", "datededepart", "enddate", "fin", "au", "to", "departure"],
    check_in_time: ["heurearrivee", "checkintime", "heuredarrivee", "arrivaltime"],
    check_out_time: ["heuredepart", "checkouttime", "heurededepart", "departuretime"],
    guest_name: ["voyageur", "nomduvoyageur", "guest", "guestname", "guestnames", "client", "nomclient", "locataire", "booker", "bookedby"],
    guests: ["voyageurs", "nombredevoyageurs", "guests", "persons", "personnes", "nbpersonnes", "pax", "numberofguests"],
    adults: ["adultes", "adults", "ofadults", "nombredadultes"],
    children: ["enfants", "children", "ofchildren", "nombredenfants"],
    babies: ["bebes", "infants", "babies", "ofinfants"],
    source: ["source", "canal", "channel", "plateforme", "platform", "provenance"],
    external_ref: ["reference", "ref", "confirmationcode", "codedeconfirmation", "booknumber", "bookingnumber", "bookingid", "reservationid", "numerodereservation", "id"],
    status: ["statut", "status", "etat"],
    guest_email: ["email", "emailvoyageur", "guestemail", "mail", "courriel"],
    notes: ["notes", "remarques", "commentaires", "comments", "message"],
  },
};

/** Colonnes sensibles jamais importées par ce parcours (codes, documents, paiement, mots de passe). */
const SENSITIVE = ["code", "codeacces", "codedacces", "digicode", "codeporte", "codeboite", "keybox", "accesscode", "doorcode", "lockcode", "wifi", "motdepasse", "password", "mdp",
  "passeport", "passport", "pieceidentite", "identite", "idcard", "carteidentite", "iban", "bic", "rib", "carte", "cartebancaire", "creditcard", "card", "cvv", "numerosecu", "securitesociale", "ssn", "nationalite", "nationality", "datenaissance", "birthdate", "dateofbirth"];

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Une colonne sensible ne quitte jamais le navigateur (codes d'accès, pièces d'identité, paiement…). */
export function isSensitiveHeader(header: string) {
  const n = norm(header);
  if (!n) return false;
  // « Code postal », « Code de confirmation » ne sont pas sensibles
  if (/^(codepostal|postalcode|cp|confirmationcode|codedeconfirmation|codepays|countrycode)$/.test(n)) return false;
  return SENSITIVE.some((w) => n === w || (w.length > 4 && n.includes(w)));
}

/** Correspondance proposée colonne → champ (le responsable peut tout modifier). */
export function autoMap(kind: ImportKind, headers: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  const syn = SYNONYMS[kind];
  // Passe 1 : égalité stricte ; passe 2 : le libellé commence par un synonyme assez long
  for (const pass of [1, 2]) {
    for (const h of headers) {
      if (out[h] !== undefined || isSensitiveHeader(h)) continue;
      const n = norm(h);
      for (const [field, words] of Object.entries(syn)) {
        if (used.has(field)) continue;
        if ((pass === 1 && words.includes(n)) || (pass === 2 && words.some((w) => w.length >= 5 && n.startsWith(w)))) {
          out[h] = field;
          used.add(field);
          break;
        }
      }
    }
  }
  for (const h of headers) if (out[h] === undefined) out[h] = "";
  return out;
}

/** CSV : séparateur détecté (; , tabulation), guillemets, retours à la ligne dans les champs, BOM. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  const firstLine = t.slice(0, t.search(/\r?\n/) === -1 ? t.length : t.search(/\r?\n/));
  const count = (c: string) => firstLine.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (quoted) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

/** Ordre jour/mois déduit de la colonne : « 25/06 » ⇒ JJ/MM ; « 06/25 » ⇒ MM/JJ ; ambigu ⇒ JJ/MM (usage français). */
export function detectDateOrder(values: string[]): "dmy" | "mdy" {
  for (const v of values) {
    const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (!m) continue;
    if (Number(m[1]) > 12) return "dmy";
    if (Number(m[2]) > 12) return "mdy";
  }
  return "dmy";
}

/** Date (et heure éventuelle) lue → { date: AAAA-MM-JJ, time?: HH:MM } ; null si non reconnue. */
export function parseDateCell(v: string, order: "dmy" | "mdy" = "dmy"): { date: string; time?: string } | null {
  const s = v.trim();
  if (!s) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  const valid = (y: number, mo: number, d: number) => {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d && y >= 2000 && y <= 2100;
  };
  const time = (h?: string, mi?: string) => (h !== undefined ? (Number(h) <= 23 && Number(mi ?? 0) <= 59 ? `${pad(Number(h))}:${pad(Number(mi ?? 0))}` : "bad") : undefined);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2})[:h](\d{2})(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}:?\d{2})?$/i);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const tm = time(m[4], m[5]);
    if (!valid(y, mo, d) || tm === "bad") return null;
    return { date: `${y}-${pad(mo)}-${pad(d)}`, ...(tm ? { time: tm } : {}) };
  }
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?:[ T,]+(\d{1,2})[:h](\d{2})(?::\d{2})?)?$/i);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [d, mo] = order === "dmy" ? [a, b] : [b, a];
    const tm = time(m[4], m[5]);
    if (!valid(y, mo, d) || tm === "bad") return null;
    return { date: `${y}-${pad(mo)}-${pad(d)}`, ...(tm ? { time: tm } : {}) };
  }
  // Numéro de série Excel (jours depuis le 30/12/1899)
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const n = Number(s);
    const ms = Math.round((n - 25569) * 86_400_000);
    const dt = new Date(ms);
    if (dt.getUTCFullYear() < 2000 || dt.getUTCFullYear() > 2100) return null;
    const hasTime = n % 1 !== 0;
    return { date: `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`, ...(hasTime ? { time: `${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}` } : {}) };
  }
  return null;
}

export function parseTimeCell(v: string): string | null {
  const m = v.trim().match(/^(\d{1,2})(?:[:h](\d{2}))?(?::\d{2})?\s*(am|pm)?$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (m[3]) h = (h % 12) + (/pm/i.test(m[3]) ? 12 : 0);
  if (h > 23 || mi > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(mi).padStart(2, "0")}`;
}

/** Téléphone : chiffres et « + » seulement ; 8 à 15 chiffres ; format français 0X converti en +33. */
export function normalizePhone(v: string): string | null {
  const s = v.trim().replace(/[\s.\-()/]/g, "");
  if (!s) return null;
  let p = s.startsWith("00") ? `+${s.slice(2)}` : s;
  if (/^0[1-9]\d{8}$/.test(p)) p = `+33${p.slice(1)}`;
  if (!/^\+?\d{8,15}$/.test(p)) return null;
  return p;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const COUNTRIES: Record<string, string> = { france: "FR", fr: "FR", belgique: "BE", belgium: "BE", be: "BE", suisse: "CH", switzerland: "CH", ch: "CH", espagne: "ES", spain: "ES", es: "ES", italie: "IT", italy: "IT", it: "IT", portugal: "PT", pt: "PT", allemagne: "DE", germany: "DE", de: "DE", royaumeuni: "GB", unitedkingdom: "GB", uk: "GB", gb: "GB", luxembourg: "LU", lu: "LU", monaco: "MC", mc: "MC", maroc: "MA", morocco: "MA", ma: "MA", etatsunis: "US", unitedstates: "US", usa: "US", us: "US", canada: "CA", ca: "CA", grece: "GR", greece: "GR", gr: "GR", paysbas: "NL", netherlands: "NL", nl: "NL" };
const COUNTRY_TZ: Record<string, string> = { FR: "Europe/Paris", BE: "Europe/Brussels", CH: "Europe/Zurich", ES: "Europe/Madrid", IT: "Europe/Rome", PT: "Europe/Lisbon", DE: "Europe/Berlin", GB: "Europe/London", LU: "Europe/Luxembourg", MC: "Europe/Monaco", MA: "Africa/Casablanca", GR: "Europe/Athens", NL: "Europe/Amsterdam" };

function isTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function intCell(v: string, min: number, max: number): number | null | "bad" {
  const s = v.trim();
  if (!s) return null;
  if (!/^\d+$/.test(s)) return "bad";
  const n = Number(s);
  return n < min || n > max ? "bad" : n;
}

/** Heure locale d'un lieu → instant réel (indépendant du serveur). */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(ms))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)) - ms;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t).toISOString();
}

export interface ExistingProperty {
  id: string;
  name: string;
  external_ref?: string | null;
  timezone: string;
  check_in: string;
  check_out: string;
}
export interface ExistingStay {
  id: string;
  property_id: string;
  check_in_at: string;
  check_out_at: string;
  external_uid?: string | null;
}
export interface AnalyzeContext {
  properties: ExistingProperty[];
  stays: ExistingStay[];
  teamEmails: string[];
  /** Logements du même fichier (analysés avant les séjours) : numéro de ligne, nom, référence, fuseau, heures */
  fileProperties?: { row: number; name: string; external_ref?: string | null; timezone: string; check_in: string; check_out: string; decision: string; matchId: string | null }[];
}
export interface AnalyzedRow {
  row: number;
  data: Record<string, unknown> | null;
  issues: string[];
  decision: "create" | "link" | "ignore" | "reject";
  matchId: string | null;
  label: string;
}

const BLOCKING = /^(missing|invalid_date|invalid_number|invalid_email|invalid_country|invalid_timezone|invalid_time|dates_order|unknown_property|invalid_role|invalid_status)/;

/** Analyse d'un type de données : aucune écriture, seulement ce qui serait fait et pourquoi. */
export function analyzeRows(kind: ImportKind, headers: string[], rows: Record<string, string>[], mapping: Record<string, string>, ctx: AnalyzeContext): AnalyzedRow[] {
  const col = (field: string) => headers.find((h) => mapping[h] === field);
  const get = (r: Record<string, string>, field: string) => {
    const h = col(field);
    return h ? (r[h] ?? "").toString().trim() : "";
  };
  const order = detectDateOrder([...rows.map((r) => get(r, "check_in")), ...rows.map((r) => get(r, "check_out"))]);
  const seen = new Map<string, number>();
  const out: AnalyzedRow[] = [];
  rows.forEach((r, i) => {
    const row = i + 1;
    const issues: string[] = [];
    let data: Record<string, unknown> = {};
    let matchId: string | null = null;
    let dupKey = "";
    let label = "";
    if (kind === "properties") {
      const name = get(r, "name");
      label = name;
      if (!name) issues.push("missing:name");
      const countryRaw = get(r, "country");
      const country = countryRaw ? (COUNTRIES[norm(countryRaw)] ?? (/^[a-z]{2}$/i.test(countryRaw) ? countryRaw.toUpperCase() : null)) : "FR";
      if (!country) issues.push("invalid_country");
      const tzRaw = get(r, "timezone");
      const tz = tzRaw ? (isTimeZone(tzRaw) ? tzRaw : null) : (COUNTRY_TZ[country ?? "FR"] ?? "Europe/Paris");
      if (!tz) issues.push("invalid_timezone");
      const cap = intCell(get(r, "capacity"), 0, 100);
      if (cap === "bad") issues.push("invalid_number:capacity");
      const clean = intCell(get(r, "cleaning_minutes"), 5, 1440);
      if (clean === "bad") issues.push("invalid_number:cleaning_minutes");
      const cin = get(r, "check_in_time") ? parseTimeCell(get(r, "check_in_time")) : null;
      if (get(r, "check_in_time") && !cin) issues.push("invalid_time:check_in_time");
      const cout = get(r, "check_out_time") ? parseTimeCell(get(r, "check_out_time")) : null;
      if (get(r, "check_out_time") && !cout) issues.push("invalid_time:check_out_time");
      data = {
        name: name.slice(0, 120),
        address: get(r, "address").slice(0, 200) || null,
        postal_code: get(r, "postal_code").slice(0, 20) || null,
        city: get(r, "city").slice(0, 120) || null,
        country,
        timezone: tz,
        capacity: typeof cap === "number" ? cap : null,
        check_in_time: cin,
        check_out_time: cout,
        cleaning_minutes: typeof clean === "number" ? clean : null,
        instructions: get(r, "instructions").slice(0, 2000) || null,
        external_ref: get(r, "external_ref").slice(0, 120) || null,
      };
      const ref = (data.external_ref as string | null) ?? "";
      const existing = ctx.properties.find((p) => (ref && p.external_ref === ref) || norm(p.name) === norm(name));
      if (name && existing) {
        issues.push("dup_existing");
        matchId = existing.id;
      }
      dupKey = ref ? `ref:${ref}` : `name:${norm(name)}`;
    } else if (kind === "team") {
      let first = get(r, "first_name");
      let last = get(r, "last_name");
      const full = get(r, "full_name");
      if (!first && !last && full) {
        const parts = full.split(/\s+/);
        first = parts[0];
        last = parts.slice(1).join(" ");
      }
      label = [first, last].filter(Boolean).join(" ");
      if (!first && !last) issues.push("missing:name");
      const email = get(r, "email").toLowerCase();
      if (email && !EMAIL_RE.test(email)) issues.push("invalid_email");
      const phoneRaw = get(r, "phone");
      const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
      if (phoneRaw && !phone) issues.push("invalid_phone"); // signalé, non bloquant : le numéro est simplement ignoré
      const roleRaw = norm(get(r, "role"));
      const role = !roleRaw ? "agent" : /^(manager|responsable|gestionnaire|admin|administrateur)/.test(roleRaw) ? "manager" : /^(agent|intervenant|menage|equipe|staff|terrain)/.test(roleRaw) ? "agent" : null;
      if (!role) issues.push("invalid_role");
      const posRaw = norm(get(r, "position"));
      const position = !posRaw ? null : /menage|femmedemenage|housekeep|clean/.test(posRaw) ? "housekeeper" : /controle|inspect/.test(posRaw) ? "inspector" : /maintenance|technicien|bricol|handyman/.test(posRaw) ? "maintenance" : /linge|blanchis|laundry/.test(posRaw) ? "laundry" : /concierge|accueil|checkin/.test(posRaw) ? "concierge" : /chauffeur|driver/.test(posRaw) ? "driver" : /chef|cuisin/.test(posRaw) ? "chef" : "other";
      const wt = norm(get(r, "worker_type"));
      const worker_type = !wt ? null : /salari|employ|cdi|cdd/.test(wt) ? "employee" : /prestat|freelance|indep|autoentre|contract|externe/.test(wt) ? "contractor" : null;
      if (wt && !worker_type) issues.push("unknown_worker_type");
      data = { first_name: first.slice(0, 80) || null, last_name: last.slice(0, 80) || null, email: email || null, phone, role, position, worker_type };
      if (email && ctx.teamEmails.includes(email)) issues.push("dup_existing");
      dupKey = email ? `mail:${email}` : `name:${norm(label)}`;
    } else {
      const propRaw = get(r, "property");
      const ref = get(r, "external_ref");
      label = [get(r, "guest_name"), propRaw].filter(Boolean).join(" · ");
      if (!propRaw) issues.push("missing:property");
      // Logement : d'abord ceux du fichier (nom ou référence), puis ceux déjà dans HALO
      const fp = ctx.fileProperties?.find((p) => p.decision !== "reject" && p.decision !== "ignore" && ((p.external_ref && p.external_ref === propRaw) || norm(p.name) === norm(propRaw)));
      const ep = ctx.properties.find((p) => (p.external_ref && p.external_ref === propRaw) || norm(p.name) === norm(propRaw));
      const target = fp ? (fp.decision === "link" && fp.matchId ? { kind: "existing" as const, id: fp.matchId, tz: fp.timezone, ci: fp.check_in, co: fp.check_out } : { kind: "file" as const, row: fp.row, tz: fp.timezone, ci: fp.check_in, co: fp.check_out }) : ep ? { kind: "existing" as const, id: ep.id, tz: ep.timezone, ci: ep.check_in, co: ep.check_out } : null;
      if (propRaw && !target) issues.push("unknown_property");
      const ciRaw = get(r, "check_in");
      const coRaw = get(r, "check_out");
      const ci = ciRaw ? parseDateCell(ciRaw, order) : null;
      const co = coRaw ? parseDateCell(coRaw, order) : null;
      if (!ciRaw) issues.push("missing:check_in");
      else if (!ci) issues.push("invalid_date:check_in");
      if (!coRaw) issues.push("missing:check_out");
      else if (!co) issues.push("invalid_date:check_out");
      const tIn = get(r, "check_in_time") ? parseTimeCell(get(r, "check_in_time")) : null;
      const tOut = get(r, "check_out_time") ? parseTimeCell(get(r, "check_out_time")) : null;
      if (get(r, "check_in_time") && !tIn) issues.push("invalid_time:check_in_time");
      if (get(r, "check_out_time") && !tOut) issues.push("invalid_time:check_out_time");
      const tz = target?.tz ?? "Europe/Paris";
      let checkInAt: string | null = null;
      let checkOutAt: string | null = null;
      if (ci && co) {
        checkInAt = zonedIso(ci.date, tIn ?? ci.time ?? (target?.ci ?? "16:00").slice(0, 5), tz);
        checkOutAt = zonedIso(co.date, tOut ?? co.time ?? (target?.co ?? "11:00").slice(0, 5), tz);
        if (Date.parse(checkOutAt) <= Date.parse(checkInAt)) issues.push("dates_order");
      }
      const n = (f: string, max: number) => {
        const v = intCell(get(r, f), 0, max);
        if (v === "bad") issues.push(`invalid_number:${f}`);
        return typeof v === "number" ? v : null;
      };
      const guests = n("guests", 100);
      let adults = n("adults", 100);
      const children = n("children", 100);
      const babies = n("babies", 20);
      if (adults === null && guests !== null) adults = Math.max(0, guests - (children ?? 0));
      const srcN = norm(get(r, "source"));
      const source = /airbnb/.test(srcN) ? "airbnb" : /booking/.test(srcN) ? "booking" : /vrbo|abritel|homeaway/.test(srcN) ? "vrbo" : srcN ? "other" : "manual";
      const stN = norm(get(r, "status"));
      const status = !stN ? "confirmed" : /annul|cancel/.test(stN) ? "cancelled" : /bloq|block|indispo|unavail|ferme|closed/.test(stN) ? "blocked" : /confirm|accept|reserv|book|ok|valid|paye|paid/.test(stN) ? "confirmed" : null;
      if (!status) issues.push("invalid_status");
      const email = get(r, "guest_email").toLowerCase();
      if (email && !EMAIL_RE.test(email)) issues.push("invalid_email");
      data = {
        property_id: target?.kind === "existing" ? target.id : null,
        property_row: target?.kind === "file" ? target.row : null,
        check_in_at: checkInAt,
        check_out_at: checkOutAt,
        guest_name: get(r, "guest_name").slice(0, 120) || null,
        adults,
        children,
        babies,
        source,
        external_ref: ref.slice(0, 200) || null,
        status,
        guest_email: email || null,
        notes: get(r, "notes").slice(0, 2000) || null,
      };
      const existing =
        target?.kind === "existing" && checkInAt && checkOutAt
          ? ctx.stays.find((s) => s.property_id === target.id && ((ref && s.external_uid === ref) || (Date.parse(s.check_in_at) === Date.parse(checkInAt!) && Date.parse(s.check_out_at) === Date.parse(checkOutAt!))))
          : null;
      if (existing) {
        issues.push("dup_existing");
        matchId = existing.id;
      }
      dupKey = ref ? `ref:${ref}` : `${norm(propRaw)}|${checkInAt}|${checkOutAt}`;
    }
    const first = dupKey ? seen.get(dupKey) : undefined;
    if (first !== undefined) issues.push(`dup_in_file:${first}`);
    else if (dupKey) seen.set(dupKey, row);
    const blocking = issues.some((x) => BLOCKING.test(x));
    const decision: AnalyzedRow["decision"] = blocking
      ? "reject"
      : issues.some((x) => x.startsWith("dup_in_file"))
        ? "ignore"
        : matchId
          ? kind === "properties"
            ? "link"
            : "ignore"
          : issues.includes("dup_existing")
            ? "ignore"
            : "create";
    out.push({ row, data: blocking ? null : data, issues, decision, matchId, label: label.slice(0, 120) });
  });
  return out;
}

/** Colonnes du fichier sans équivalent HALO (affichées au responsable, jamais importées). */
export function unmappedColumns(headers: string[], mapping: Record<string, string>) {
  return headers.filter((h) => !mapping[h]);
}

/** Modèles téléchargeables (séparateur « ; », ouvrables dans Excel, Numbers, Google Sheets). */
export const TEMPLATES: Record<ImportKind, string[][]> = {
  properties: [
    ["Nom", "Adresse", "Code postal", "Ville", "Pays", "Fuseau horaire", "Capacité", "Heure d'arrivée", "Heure de départ", "Durée ménage (min)", "Consignes", "Référence"],
    ["Studio Canal", "12 quai de Jemmapes", "75010", "Paris", "France", "Europe/Paris", "2", "16:00", "11:00", "90", "Poubelles : bac jaune le mardi", "LOG-001"],
  ],
  team: [
    ["Prénom", "Nom", "E-mail professionnel", "Téléphone professionnel", "Rôle", "Poste", "Statut"],
    ["Camille", "Martin", "camille@exemple.fr", "06 12 34 56 78", "Agent", "Ménage", "Prestataire"],
  ],
  stays: [
    ["Logement", "Arrivée", "Départ", "Voyageur", "Voyageurs", "Source", "Référence", "Statut", "E-mail voyageur"],
    ["Studio Canal", "15/11/2026 16:00", "18/11/2026 11:00", "Alex Dupont", "2", "Airbnb", "HMABC123", "Confirmé", ""],
  ],
};
export function toCsv(rows: string[][]) {
  return "﻿" + rows.map((r) => r.map((c) => (/[;"\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(";")).join("\r\n") + "\r\n";
}
