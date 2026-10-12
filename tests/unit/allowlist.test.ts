import { describe, expect, it } from "vitest";
import { signupAllowed } from "@/server/auth/allowlist";
import { workerAlive } from "@/lib/freshness";

describe("signupAllowed", () => {
  it("is open when unset, blank or *", () => {
    expect(signupAllowed("a@b.com", undefined)).toBe(true);
    expect(signupAllowed("a@b.com", " , ")).toBe(true);
    expect(signupAllowed("a@b.com", "me@x.com, *")).toBe(true);
  });
  it("matches exact emails and @domains, case-insensitively", () => {
    const list = "Owner@Example.com, @acme.co";
    expect(signupAllowed("owner@example.com", list)).toBe(true);
    expect(signupAllowed("anyone@ACME.co", list)).toBe(true);
    expect(signupAllowed("other@example.com", list)).toBe(false);
    expect(signupAllowed("x@notacme.co", list)).toBe(false);
    expect(signupAllowed("x@acme.co.evil.com", list)).toBe(false);
  });
});

describe("workerAlive", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  it("expects queue workers to beat within two minutes", () => {
    expect(workerAlive({ at: "2026-01-01T11:59:00Z", mode: "queue" }, now)).toBe(true);
    expect(workerAlive({ at: "2026-01-01T11:55:00Z", mode: "queue" }, now)).toBe(false);
  });
  it("gives scheduled runners two hours (hosted crons start late)", () => {
    expect(workerAlive({ at: "2026-01-01T10:30:00Z", mode: "scheduled" }, now)).toBe(true);
    expect(workerAlive({ at: "2026-01-01T09:30:00Z", mode: "scheduled" }, now)).toBe(false);
    expect(workerAlive(null, now)).toBe(false);
  });
});
