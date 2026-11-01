import { describe, expect, it } from "vitest";
import { period, score, summarize, type ReviewRow } from "@/lib/engine/satisfaction";

const r = (over: Partial<ReviewRow>): ReviewRow => ({ kind: "guest", source: "halo", verified: true, overall: 5, ratings: {}, would_return: null, review_date: "2026-10-01", ...over });

describe("satisfaction", () => {
  it("aucune moyenne sans avis", () => {
    const s = score([], "guest");
    expect(s).toMatchObject({ count: 0, average: null });
    expect(s.questions.cleanliness).toEqual({ answered: 0, unanswered: 0, average: null });
  });
  it("questions sans réponse comptées à part, toutes les notes gardées", () => {
    const s = score([r({ overall: 1, ratings: { cleanliness: 1 } }), r({ overall: 5, ratings: {} }), r({ overall: 4, ratings: { cleanliness: 5 }, would_return: true })], "guest");
    expect(s.count).toBe(3);
    expect(s.average).toBe(3.3);
    expect(s.distribution).toEqual({ 1: 1, 2: 0, 3: 0, 4: 1, 5: 1 });
    expect(s.questions.cleanliness).toEqual({ answered: 2, unanswered: 1, average: 3 });
    expect(s.wouldReturn).toEqual({ yes: 1, no: 0, unanswered: 2 });
  });
  it("voyageurs et propriétaires séparés ; vérifiés et importés séparés ; période respectée", () => {
    const rows = [r({}), r({ kind: "owner", overall: 2 }), r({ source: "imported", verified: false, overall: 3 }), r({ review_date: "2024-01-01", overall: 1 })];
    const s = summarize(rows, "guest", { from: "2025-11-01", to: "2026-11-01" });
    expect(s.verified).toMatchObject({ count: 1, average: 5 });
    expect(s.imported).toMatchObject({ count: 1, average: 3 });
    expect(summarize(rows, "owner", { from: "2025-11-01", to: "2026-11-01" }).verified).toMatchObject({ count: 1, average: 2 });
  });
  it("service de la conciergerie : séparé du séjour, anciens avis sans note jamais comptés", () => {
    const s = score([r({ overall: 5, service_overall: 2 }), r({ overall: 4 }), r({ overall: 3, service_overall: 4 })], "guest");
    expect(s.average).toBe(4);
    expect(s.service).toEqual({ answered: 2, unanswered: 1, average: 3 });
    expect(score([r({ overall: 5 })], "guest").service).toEqual({ answered: 0, unanswered: 1, average: null });
  });
  it("période glissante", () => {
    expect(period(12, new Date("2026-11-01T10:00:00Z"))).toEqual({ from: "2025-11-01", to: "2026-11-01" });
  });
});
