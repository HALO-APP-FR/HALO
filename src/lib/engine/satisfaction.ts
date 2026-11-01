/**
 * Calculs de satisfaction — fonctions PURES, testées.
 * Règles : aucune moyenne sans avis ; questions sans réponse comptées à part ; avis HALO vérifiés et avis importés
 * séparés ; toutes les notes de la période (aucune exclusion).
 */
export type ReviewKind = "guest" | "owner";
export const QUESTIONS: Record<ReviewKind, string[]> = {
  guest: ["cleanliness", "condition", "checkin", "communication"],
  owner: ["communication", "reactivity", "follow_up", "quality", "transparency"],
};

export interface ReviewRow {
  kind: ReviewKind;
  source: "halo" | "imported";
  verified: boolean;
  overall: number;
  /** Note du service de la conciergerie (voyageur) ; vide pour les anciens avis et les propriétaires */
  service_overall?: number | null;
  ratings: Record<string, number>;
  would_return: boolean | null;
  review_date: string; // AAAA-MM-JJ
}

export interface Score {
  count: number;
  average: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  questions: Record<string, { answered: number; unanswered: number; average: number | null }>;
  /** Service de la conciergerie : seuls les avis qui l'ont noté comptent (jamais déduit d'autres champs) */
  service: { answered: number; unanswered: number; average: number | null };
  wouldReturn: { yes: number; no: number; unanswered: number };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

export function score(rows: ReviewRow[], kind: ReviewKind): Score {
  const list = rows.filter((r) => r.kind === kind);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Score["distribution"];
  for (const r of list) distribution[r.overall as 1 | 2 | 3 | 4 | 5]++;
  const questions = Object.fromEntries(
    QUESTIONS[kind].map((q) => {
      const vals = list.map((r) => r.ratings?.[q]).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
      return [q, { answered: vals.length, unanswered: list.length - vals.length, average: vals.length ? round1(vals.reduce((a, b) => a + b, 0) / vals.length) : null }];
    }),
  );
  const sv = list.map((r) => r.service_overall).filter((v): v is number => typeof v === "number" && v >= 1 && v <= 5);
  return {
    service: { answered: sv.length, unanswered: list.length - sv.length, average: sv.length ? round1(sv.reduce((a, b) => a + b, 0) / sv.length) : null },
    count: list.length,
    average: list.length ? round1(list.reduce((a, r) => a + r.overall, 0) / list.length) : null,
    distribution,
    questions,
    wouldReturn: { yes: list.filter((r) => r.would_return === true).length, no: list.filter((r) => r.would_return === false).length, unanswered: list.filter((r) => r.would_return == null).length },
  };
}

/** Période glissante en mois, bornes incluses (dates locales AAAA-MM-JJ). */
export function period(months: number, today = new Date()): { from: string; to: string } {
  const to = today.toISOString().slice(0, 10);
  const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - months, today.getUTCDate()));
  return { from: d.toISOString().slice(0, 10), to };
}

/** Sépare les avis HALO vérifiés et les avis importés, sur la période (rien n'est exclu selon la note). */
export function summarize(rows: ReviewRow[], kind: ReviewKind, p: { from: string; to: string }) {
  const inPeriod = rows.filter((r) => r.review_date >= p.from && r.review_date <= p.to);
  return {
    period: p,
    verified: score(inPeriod.filter((r) => r.source === "halo" && r.verified), kind),
    imported: score(inPeriod.filter((r) => r.source === "imported"), kind),
  };
}
