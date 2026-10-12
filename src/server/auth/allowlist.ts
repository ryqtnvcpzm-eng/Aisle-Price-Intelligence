/**
 * Sign-up allowlist for public deployments. `SIGNUP_ALLOWLIST` is a comma-
 * separated list of exact emails and/or `@domain` entries; unset or `*` means
 * anyone may register. Pure so it can be unit-tested without a server.
 */
export function signupAllowed(email: string, allowlist: string | undefined): boolean {
  const entries = (allowlist ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (entries.length === 0 || entries.includes("*")) return true;
  const addr = email.trim().toLowerCase();
  const domain = addr.slice(addr.lastIndexOf("@"));
  return entries.some((e) => (e.startsWith("@") ? domain === e : addr === e));
}
