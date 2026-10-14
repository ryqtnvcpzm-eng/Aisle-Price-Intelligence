/**
 * Calendar weeks in a workspace's time zone. A briefing covers the previous
 * Monday 00:00 → next Monday 00:00 local time, stored as UTC instants.
 */

function localParts(timeZone: string, at: Date) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, min: Number(p.minute), s: Number(p.second), weekday: p.weekday as string };
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetMinutes(timeZone: string, at: Date) {
  const p = localParts(timeZone, at);
  return Math.round((Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s) - Math.floor(at.getTime() / 1000) * 1000) / 60_000);
}

/** The UTC instant of local midnight on a calendar date (DST-safe: re-checks the offset at the result). */
export function localMidnight(dateIso: string, timeZone: string): Date {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  const naive = Date.UTC(y, m - 1, d);
  let guess = new Date(naive - offsetMinutes(timeZone, new Date(naive)) * 60_000);
  guess = new Date(naive - offsetMinutes(timeZone, guess) * 60_000);
  return guess;
}

export function addDays(dateIso: string, days: number) {
  const [y, m, d] = dateIso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

export interface Week {
  /** Local Monday, YYYY-MM-DD. */
  weekStart: string;
  /** Local Sunday, YYYY-MM-DD. */
  weekEnd: string;
  periodStart: Date;
  periodEnd: Date;
  timeZone: string;
}

export function weekStarting(weekStart: string, timeZone: string): Week {
  return { weekStart, weekEnd: addDays(weekStart, 6), periodStart: localMidnight(weekStart, timeZone), periodEnd: localMidnight(addDays(weekStart, 7), timeZone), timeZone };
}

/** The most recent fully finished Monday–Sunday week, in the given zone. */
export function lastCompletedWeek(timeZone: string, now = new Date()): Week {
  const p = localParts(timeZone, now);
  const today = `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
  const thisMonday = addDays(today, -(WEEKDAY_INDEX[p.weekday] ?? 0));
  return weekStarting(addDays(thisMonday, -7), timeZone);
}

export function isWeekStart(v: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const [y, m, d] = v.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.toISOString().slice(0, 10) === v && dt.getUTCDay() === 1;
}

/** "6–12 Oct 2026" style label. */
export function weekLabel(w: Pick<Week, "weekStart" | "weekEnd">) {
  const f = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...opts }).format(new Date(`${iso}T00:00:00Z`));
  const sameMonth = w.weekStart.slice(0, 7) === w.weekEnd.slice(0, 7);
  return sameMonth ? `${f(w.weekStart, { day: "numeric" })}–${f(w.weekEnd, { day: "numeric", month: "short", year: "numeric" })}` : `${f(w.weekStart, { day: "numeric", month: "short" })} – ${f(w.weekEnd, { day: "numeric", month: "short", year: "numeric" })}`;
}
