/**
 * Lecture des calendriers iCal (Airbnb, Booking, Vrbo, PMS…) — docs/04 §1.
 * Analyseur PUR et autonome (fonctionne côté serveur comme dans le navigateur).
 */
import type { Property, ReservationStatus } from "@/lib/domain/types";
import { addDaysToKey, zonedTimeToUtc } from "./time";

export interface ParsedEvent {
  uid: string;
  summary: string;
  status: ReservationStatus;
  checkInAt: string;
  checkOutAt: string;
  guestName?: string;
}

const BLOCK_WORDS = ["not available", "blocked", "closed", "unavailable", "indisponible", "bloqué", "fermé", "no disponible", "nicht verfügbar"];

/** Déplie les lignes iCal (une ligne commençant par espace ou tabulation continue la précédente). */
function unfold(text: string): string[] {
  return text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n");
}

interface RawProp {
  params: Record<string, string>;
  value: string;
}

function parseLine(line: string): [string, RawProp] | null {
  const colon = line.indexOf(":");
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...paramParts] = head.split(";");
  const params: Record<string, string> = {};
  for (const p of paramParts) {
    const [k, v] = p.split("=");
    if (k && v) params[k.toUpperCase()] = v.replace(/^"|"$/g, "");
  }
  return [name.toUpperCase(), { params, value }];
}

function unescapeText(v: string) {
  return v.replace(/\\n/gi, " ").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

/**
 * Convertit une date iCal en instant UTC.
 * - Date sans heure (VALUE=DATE, cas Airbnb/Booking) → heure par défaut du logement, dans SON fuseau.
 * - Date-heure en UTC (…Z) → telle quelle.
 * - Date-heure avec TZID ou flottante → interprétée dans le fuseau indiqué, sinon celui du logement.
 */
function toInstant(prop: RawProp, defaultTime: string, propertyTz: string): string | null {
  const v = prop.value.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (dateOnly) {
    const key = `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`;
    return zonedTimeToUtc(key, defaultTime, propertyTz).toISOString();
  }
  const dt = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(v);
  if (!dt) return null;
  const key = `${dt[1]}-${dt[2]}-${dt[3]}`;
  const time = `${dt[4]}:${dt[5]}`;
  if (dt[7] === "Z") {
    return new Date(Date.UTC(+dt[1], +dt[2] - 1, +dt[3], +dt[4], +dt[5], +(dt[6] ?? 0))).toISOString();
  }
  const tz = prop.params.TZID ?? propertyTz;
  try {
    return zonedTimeToUtc(key, time, tz).toISOString();
  } catch {
    return zonedTimeToUtc(key, time, propertyTz).toISOString();
  }
}

export function parseIcs(
  text: string,
  property: Pick<Property, "timezone" | "defaultCheckIn" | "defaultCheckOut">,
): ParsedEvent[] {
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not_ical");
  const events: ParsedEvent[] = [];
  let current: Map<string, RawProp> | null = null;

  for (const line of unfold(text)) {
    const trimmed = line.trim();
    if (/^BEGIN:VEVENT$/i.test(trimmed)) {
      current = new Map();
      continue;
    }
    if (/^END:VEVENT$/i.test(trimmed)) {
      if (current) {
        const ev = toEvent(current, property);
        if (ev) events.push(ev);
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const parsed = parseLine(trimmed);
    if (parsed && !current.has(parsed[0])) current.set(parsed[0], parsed[1]);
  }
  return events;
}

function toEvent(
  props: Map<string, RawProp>,
  property: Pick<Property, "timezone" | "defaultCheckIn" | "defaultCheckOut">,
): ParsedEvent | null {
  const start = props.get("DTSTART");
  if (!start) return null;
  let end = props.get("DTEND");
  // Sans DTEND, un événement « journée » dure une nuit
  if (!end && /^\d{8}$/.test(start.value.trim())) {
    const v = start.value.trim();
    const next = addDaysToKey(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, 1).replace(/-/g, "");
    end = { params: {}, value: next };
  }
  if (!end) return null;

  const checkInAt = toInstant(start, property.defaultCheckIn, property.timezone);
  const checkOutAt = toInstant(end, property.defaultCheckOut, property.timezone);
  if (!checkInAt || !checkOutAt || new Date(checkOutAt) <= new Date(checkInAt)) return null;

  const summary = unescapeText(props.get("SUMMARY")?.value ?? "");
  const lower = summary.toLowerCase();
  const cancelled = (props.get("STATUS")?.value ?? "").trim().toUpperCase() === "CANCELLED";
  const blocked = BLOCK_WORDS.some((w) => lower.includes(w));
  const uid = props.get("UID")?.value.trim() || `${checkInAt}/${checkOutAt}`;

  // Airbnb écrit « Reserved », Booking « CLOSED - Not available » : on n'invente pas de nom.
  const generic = /^(reserved|réservé|airbnb.*|booking.*|vrbo.*)$/i.test(summary);
  return {
    uid,
    summary,
    status: cancelled ? "cancelled" : blocked ? "blocked" : "confirmed",
    checkInAt,
    checkOutAt,
    guestName: !blocked && !generic && summary ? summary.slice(0, 80) : undefined,
  };
}
