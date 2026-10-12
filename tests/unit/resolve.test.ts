import { describe, expect, it, vi } from "vitest";
import { resolveShortLink } from "@/server/amazon/resolve";

const redirect = (location: string) => Promise.resolve(new Response(null, { status: 301, headers: { location } }));

describe("short-link resolution (SSRF-safe)", () => {
  it("follows allowlisted redirects to an Amazon product without fetching it", async () => {
    const f = vi.fn().mockImplementationOnce(() => redirect("https://www.amazon.in/dp/B0CXJ8QZ7M?tag=x"));
    const r = await resolveShortLink("https://amzn.to/abc", "IN", f as unknown as typeof fetch);
    expect(r).toMatchObject({ kind: "listing", marketplace: "IN", asin: "B0CXJ8QZ7M" });
    expect(f).toHaveBeenCalledTimes(1);
    expect(f.mock.calls[0]![1]).toMatchObject({ method: "HEAD", redirect: "manual", credentials: "omit" });
  });

  it("stops at the first hop that leaves the allowlist (e.g. internal address)", async () => {
    const f = vi.fn().mockImplementationOnce(() => redirect("http://169.254.169.254/latest/meta-data"));
    const r = await resolveShortLink("https://amzn.to/abc", "IN", f as unknown as typeof fetch);
    expect(r).toMatchObject({ kind: "error", code: "blocked_redirect" });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caps redirect chains", async () => {
    const f = vi.fn().mockImplementation(() => redirect("https://a.co/again"));
    const r = await resolveShortLink("https://a.co/start", "IN", f as unknown as typeof fetch);
    expect(r).toMatchObject({ kind: "error", code: "too_many_redirects" });
    expect(f.mock.calls.length).toBeLessThanOrEqual(6);
  });

  it("reports timeouts gracefully", async () => {
    const f = vi.fn().mockRejectedValue(Object.assign(new Error("x"), { name: "TimeoutError" }));
    expect(await resolveShortLink("https://amzn.to/abc", "IN", f as unknown as typeof fetch)).toMatchObject({ kind: "error", code: "timeout" });
  });
});
