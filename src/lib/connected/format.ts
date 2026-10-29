/**
 * Fenêtre de mission lisible : la date de fin est TOUJOURS affichée quand elle diffère du début
 * (une fenêtre « 8 nov. 11:00 → 11:00 » cachait une fin le 11 nov. — retour du 29/10).
 */
type Style = "full" | "long" | "medium" | "short";
type DateFormatter = { dateTime: (d: Date, o: { dateStyle?: Style; timeStyle?: Style }) => string };

export function windowText(f: DateFormatter, start: string, end: string, long = false): string {
  const s = new Date(start);
  const e = new Date(end);
  const sameDay = f.dateTime(s, { dateStyle: "short" }) === f.dateTime(e, { dateStyle: "short" });
  const startText = f.dateTime(s, { dateStyle: long ? "full" : "medium", timeStyle: "short" });
  return `${startText} → ${sameDay ? f.dateTime(e, { timeStyle: "short" }) : f.dateTime(e, { dateStyle: "medium", timeStyle: "short" })}`;
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
