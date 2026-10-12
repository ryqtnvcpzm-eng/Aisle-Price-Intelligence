import { describe, expect, it } from "vitest";
import { builtInBriefing } from "@/server/ai/explain";
import type { Insight } from "@/server/insights/engine";

const insight = (over: Partial<Insight>): Insight => ({
  id: "x",
  kind: "competitor_cut",
  severity: 50,
  tone: "neutral",
  headline: "Brand A cut Item by 10%",
  explanation: "",
  items: [],
  metrics: {},
  period: "last 24 hours",
  evidence: [],
  at: "2026-01-01T00:00:00Z",
  coverage: { observations: 10, share: 1 },
  href: "/",
  isSimulated: false,
  ...over,
});

describe("builtInBriefing (free, no AI service)", () => {
  it("leads with the most significant verified findings and counts competitor moves", () => {
    const text = builtInBriefing([
      insight({ id: "a", severity: 10, headline: "Minor thing", kind: "observed_low" }),
      insight({ id: "b", severity: 90, headline: "Brand B raised Item by 22%", kind: "competitor_raise" }),
      insight({ id: "c", severity: 50 }),
    ]);
    const lines = text.split("\n");
    expect(lines[0]).toBe("3 findings, including 2 competitor price moves. The most significant:");
    expect(lines[1]).toBe("• Brand B raised Item by 22% (last 24 hours).");
    expect(text).not.toMatch(/simulated/);
  });
  it("flags simulated data and handles the empty case", () => {
    expect(builtInBriefing([insight({ isSimulated: true })])).toMatch(/simulated demo data/);
    expect(builtInBriefing([])).toMatch(/Nothing notable yet/);
  });
});
