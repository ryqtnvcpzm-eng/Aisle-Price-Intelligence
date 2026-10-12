import { describe, expect, it } from "vitest";
import { freshnessOf, relativeTime } from "@/lib/freshness";

const now = Date.UTC(2026, 5, 1, 12);
const ago = (m: number) => new Date(now - m * 60_000);
const base = { intervalMinutes: 60, lastSuccessAt: ago(20), lastFailureAt: null, providerUpdatedAt: ago(30), nextCheckAt: ago(-40), lastObservedAt: ago(20), consecutiveFailures: 0 };

describe("freshnessOf", () => {
  it("distinguishes the four clocks", () => {
    expect(freshnessOf(base, now)).toBe("verified");
    expect(freshnessOf({ ...base, providerUpdatedAt: ago(60 * 9) }, now)).toBe("provider_stale");
    expect(freshnessOf({ ...base, lastSuccessAt: ago(200) }, now)).toBe("pending");
    expect(freshnessOf({ ...base, lastFailureAt: ago(5), consecutiveFailures: 2 }, now)).toBe("failed");
    expect(freshnessOf({ ...base, intervalMinutes: null }, now)).toBe("paused");
    expect(freshnessOf({ ...base, lastSuccessAt: null, lastObservedAt: null }, now)).toBe("unavailable");
  });
  it("formats relative time", () => {
    expect(relativeTime(ago(0.2), now)).toBe("just now");
    expect(relativeTime(ago(14), now)).toBe("14m ago");
    expect(relativeTime(ago(-120), now)).toBe("in 2h");
    expect(relativeTime(null, now)).toBe("never");
  });
});
