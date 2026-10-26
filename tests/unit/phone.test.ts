import { describe, expect, it } from "vitest";
import { isPlausiblePhone } from "@/components/halo/login-panel";

describe("isPlausiblePhone", () => {
  it("accepte les formats courants", () => {
    expect(isPlausiblePhone("06 12 34 56 78")).toBe(true);
    expect(isPlausiblePhone("+33 6 12 34 56 78")).toBe(true);
    expect(isPlausiblePhone("+351 912 345 678")).toBe(true);
    expect(isPlausiblePhone("(555) 123-4567")).toBe(true);
  });
  it("refuse le reste", () => {
    expect(isPlausiblePhone("1234")).toBe(false);
    expect(isPlausiblePhone("abc12345678")).toBe(false);
    expect(isPlausiblePhone("")).toBe(false);
  });
});
