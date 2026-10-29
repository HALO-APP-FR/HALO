import { TASK_TYPES } from "@/lib/domain/types";
import { describe, expect, it } from "vitest";
import { issueOptions, channelOptions, proposeConfiguration } from "@/lib/onboarding/propose";

const L = (k: string) => k;
const get = (r: ReturnType<typeof proposeConfiguration>, id: string) => r.proposals.find((p) => p.id === id);

describe("propositions d'onboarding", () => {
  it("pas de questions d'hôtel pour une conciergerie d'appartements", () => {
    expect(issueOptions("concierge")).not.toContain("room_not_ready");
    expect(issueOptions("independent_hotel")).toContain("room_not_ready");
    expect(channelOptions("independent_hotel")).toEqual([]);
  });
  it("conciergerie avec prestataires et blanchisserie", () => {
    const r = proposeConfiguration({ activity_type: "concierge", cleaning_model: "providers", linen_model: "laundry", welcome_service: true, frequent_issues: ["damage"] }, L);
    expect(get(r, "task_types")?.value).toEqual(["turnover", "check_in", "check_out", "linen_delivery", "linen_pickup"]);
    expect(get(r, "validation")?.value).toEqual(["turnover"]);
    expect(get(r, "validation")?.reasons).toEqual(["validation_providers"]);
    expect(JSON.stringify(get(r, "checklist")?.value)).toContain("check.damage_check");
    expect(get(r, "linen")?.value).toBe(3);
  });
  it("hôtel avec contrôle des chambres et validation de toutes les missions", () => {
    const r = proposeConfiguration({ activity_type: "independent_hotel", room_inspection: true, validation_policy: "all", linen_model: "none" }, L);
    expect(get(r, "task_types")?.value).toEqual(["turnover", "inspection"]);
    expect(get(r, "validation")?.value).toEqual(TASK_TYPES); // y compris la maintenance (retour du 29/10)
    expect(get(r, "linen")).toBeUndefined();
    expect(JSON.stringify(get(r, "checklist")?.value)).not.toContain("room.kitchen");
  });
  it("chaque proposition explique pourquoi", () => {
    const r = proposeConfiguration({}, L);
    for (const p of r.proposals) expect(p.reasons.length).toBeGreaterThan(0);
  });
});
