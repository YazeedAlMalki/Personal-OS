// Pure numeric helpers shared by the scoring + forecast layers.
// No external deps — fully unit-testable, runs with or without an LLM (P1).

export const DAY_MS = 86_400_000;

export function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function clamp01(n: number): number {
  return clamp(n, 0, 1);
}

export function round(n: number, dp = 0): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// value / target as a 0..1 ratio; null/undefined value → 0.
export function ratio(value: number | null | undefined, target: number): number {
  if (value == null || !Number.isFinite(value) || target <= 0) return 0;
  return clamp01(value / target);
}

export function parseDate(d: string | Date | null | undefined): Date | null {
  if (d == null) return null;
  const dt = d instanceof Date ? d : new Date(d.length === 10 ? d + "T00:00:00" : d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// Signed days from `now` to `date` (negative = past). null if unparseable.
export function daysUntil(date: string | Date | null | undefined, now: Date = new Date()): number | null {
  const d = parseDate(date);
  if (!d) return null;
  return (d.getTime() - now.getTime()) / DAY_MS;
}

// Whole calendar days from `now`'s local date to `date`'s local date.
// 0 = due today (regardless of time-of-day or timezone), negative = overdue.
// Use this for date-only deadlines; raw daysUntil is for timestamp math.
export function calendarDaysUntil(
  date: string | Date | null | undefined,
  now: Date = new Date(),
): number | null {
  const d = parseDate(date);
  if (!d) return null;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / DAY_MS);
}

export function daysSince(date: string | Date | null | undefined, now: Date = new Date()): number | null {
  const u = daysUntil(date, now);
  return u == null ? null : -u;
}

export function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}
