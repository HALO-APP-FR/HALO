import { describe, expect, it } from "vitest";
import { overrunAlert, overrunDueAt, REASK_MIN } from "@/lib/engine/overrun";

const start = "2026-11-05T08:00:00Z";
const t = (iso: string) => Date.parse(iso);

describe("mission trop longue", () => {
  it("rappel à la durée estimée depuis le démarrage réel", () => {
    expect(overrunDueAt(start, 90, null)).toBe(t("2026-11-05T09:30:00Z"));
  });
  it("sans durée estimée : aucun rappel", () => {
    expect(overrunDueAt(start, 0, null)).toBeNull();
    expect(overrunAlert(start, 0, null, 30, t("2026-11-06T00:00:00Z"))).toBe(false);
  });
  it("« je continue » repousse la question de REASK_MIN minutes", () => {
    expect(overrunDueAt(start, 90, "2026-11-05T09:40:00Z")).toBe(t("2026-11-05T09:40:00Z") + REASK_MIN * 60_000);
  });
  it("une réponse antérieure à la fin estimée ne compte pas", () => {
    expect(overrunDueAt(start, 90, "2026-11-05T09:00:00Z")).toBe(t("2026-11-05T09:30:00Z"));
  });
  it("alerte du responsable : seulement après le délai, sans réponse", () => {
    expect(overrunAlert(start, 90, null, 30, t("2026-11-05T09:59:00Z"))).toBe(false);
    expect(overrunAlert(start, 90, null, 30, t("2026-11-05T10:01:00Z"))).toBe(true);
    // Réponse à 9 h 45 : alerte repoussée à 10 h 15
    expect(overrunAlert(start, 90, "2026-11-05T09:45:00Z", 30, t("2026-11-05T10:10:00Z"))).toBe(false);
    expect(overrunAlert(start, 90, "2026-11-05T09:45:00Z", 30, t("2026-11-05T10:16:00Z"))).toBe(true);
  });
  it("délai nul : alerte dès la durée estimée dépassée", () => {
    expect(overrunAlert(start, 60, null, 0, t("2026-11-05T09:00:30Z"))).toBe(true);
  });
});
