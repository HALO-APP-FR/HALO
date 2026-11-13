import { describe, expect, it } from "vitest";
import { stayNow } from "@/lib/engine/stay-now";

const base = { conflicts: 0, arrivalRisks: 0, unreadGuestMessages: 0, servicesToAnswer: 0, vipPending: false, prepNeedsReview: false, blockingActions: 0, unassignedMissions: 0 };
describe("fiche séjour : maintenant", () => {
  it("rien à faire → liste vide", () => expect(stayNow(base)).toEqual([]));
  it("ordonne par urgence : conflit, puis voyageur, puis préparation", () => {
    const r = stayNow({ ...base, unassignedMissions: 1, unreadGuestMessages: 2, conflicts: 1, prepNeedsReview: true });
    expect(r.map((x) => x.key)).toEqual(["conflict", "guest_messages", "prep_review", "unassigned_missions"]);
    expect(r[1].count).toBe(2);
  });
});
