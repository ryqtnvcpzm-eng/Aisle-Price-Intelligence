import { describe, expect, it } from "vitest";
import { addDays, isWeekStart, lastCompletedWeek, localMidnight, shortDay, weekLabel, weekStarting } from "@/lib/week";

describe("weeks in a workspace time zone", () => {
  it("picks the previous Monday–Sunday in Asia/Kolkata", () => {
    const w = lastCompletedWeek("Asia/Kolkata", new Date("2026-10-14T04:30:00Z")); // Wed 10:00 IST
    expect(w).toMatchObject({ weekStart: "2026-10-05", weekEnd: "2026-10-11" });
    expect(w.periodStart.toISOString()).toBe("2026-10-04T18:30:00.000Z"); // Mon 00:00 IST
    expect(w.periodEnd.toISOString()).toBe("2026-10-11T18:30:00.000Z");
  });

  it("switches weeks exactly at local midnight on Monday", () => {
    expect(lastCompletedWeek("Asia/Kolkata", new Date("2026-10-11T18:29:00Z")).weekStart).toBe("2026-09-28"); // Sun 23:59 IST
    expect(lastCompletedWeek("Asia/Kolkata", new Date("2026-10-11T18:31:00Z")).weekStart).toBe("2026-10-05"); // Mon 00:01 IST
  });

  it("handles daylight-saving changes inside a week", () => {
    const w = weekStarting("2026-10-26", "America/New_York"); // DST ends Sun 1 Nov
    expect(w.periodStart.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(w.periodEnd.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(localMidnight("2026-11-01", "America/New_York").toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("validates and labels weeks", () => {
    expect(isWeekStart("2026-10-05")).toBe(true);
    expect(isWeekStart("2026-10-06")).toBe(false);
    expect(isWeekStart("2026-02-30")).toBe(false);
    expect(addDays("2026-12-28", 7)).toBe("2027-01-04");
    expect(weekLabel({ weekStart: "2026-10-05", weekEnd: "2026-10-11" })).toBe("5–11 Oct 2026");
    expect(weekLabel({ weekStart: "2026-09-28", weekEnd: "2026-10-04" })).toBe("28 Sep – 4 Oct 2026");
    expect(weekLabel({ weekStart: "2026-12-28", weekEnd: "2027-01-03" })).toBe("28 Dec 2026 – 3 Jan 2027");
    expect(shortDay("2026-10-11T19:00:00Z", "Asia/Kolkata")).toBe("Mon 12 Oct"); // 00:30 IST on Monday
    expect(shortDay("2026-10-11T19:00:00Z", "UTC")).toBe("Sun 11 Oct");
  });
});
