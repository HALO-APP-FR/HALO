import { describe, expect, it } from "vitest";
import { checkFeedUrl } from "@/lib/engine/feed-url";

describe("checkFeedUrl", () => {
  it("accepte les liens Airbnb, Booking et webcal", () => {
    expect(checkFeedUrl("https://www.airbnb.fr/calendar/ical/123.ics?s=abc").ok).toBe(true);
    expect(checkFeedUrl("https://admin.booking.com/hotel/hoteladmin/ical.html?t=x").ok).toBe(true);
    expect(checkFeedUrl("webcal://calendar.example.com/feed.ics").ok).toBe(true);
  });
  it("refuse le reste", () => {
    expect(checkFeedUrl("http://www.airbnb.fr/x.ics")).toEqual({ ok: false, error: "not_https" });
    expect(checkFeedUrl("https://localhost/x")).toEqual({ ok: false, error: "forbidden_host" });
    expect(checkFeedUrl("https://169.254.169.254/latest")).toEqual({ ok: false, error: "forbidden_host" });
    expect(checkFeedUrl("https://intranet/x")).toEqual({ ok: false, error: "forbidden_host" });
    expect(checkFeedUrl("https://user:pw@example.com/x")).toEqual({ ok: false, error: "forbidden_host" });
    expect(checkFeedUrl("pas une adresse")).toEqual({ ok: false, error: "invalid" });
  });
});
