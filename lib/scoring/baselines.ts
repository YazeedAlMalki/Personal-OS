import { mean } from "@/lib/scoring/util";
import { DEFAULT_TARGETS, type Targets } from "@/lib/scoring/health";

// Rolling 30-day personal averages for RHR/HRV. When the user has fewer than
// MIN_DAYS readings the system falls back to profile targets or the global
// defaults — and flags the result so callers can mark them "estimated".

const MIN_DAYS = 7;

export type BaselineRow = {
  resting_heart_rate?: number | null;
  hrv?: number | null;
};

export type Baselines = {
  rhrBaseline: number;
  hrvBaseline: number;
  estimated: boolean;
};

export function computeBaselines(rows: BaselineRow[], targets: Targets = {}): Baselines {
  const rhrs = rows
    .map((r) => r.resting_heart_rate)
    .filter((n): n is number => typeof n === "number" && n > 0);
  const hrvs = rows
    .map((r) => r.hrv)
    .filter((n): n is number => typeof n === "number" && n > 0);

  const rhrBaseline =
    rhrs.length >= MIN_DAYS
      ? Math.round(mean(rhrs))
      : (targets.rhrBaseline ?? DEFAULT_TARGETS.rhrBaseline);
  const hrvBaseline =
    hrvs.length >= MIN_DAYS
      ? Math.round(mean(hrvs))
      : (targets.hrvBaseline ?? DEFAULT_TARGETS.hrvBaseline);
  const estimated = rhrs.length < MIN_DAYS || hrvs.length < MIN_DAYS;
  return { rhrBaseline, hrvBaseline, estimated };
}

// Sleep-consistency over the last `windowDays` days — 1 minus the normalized
// stdev of bedtime/sleep duration. 0..1. Conservative: returns 0 when sample
// is too small so the recovery score doesn't reward "no data".
export function sleepConsistency(
  sleepMinutes: Array<number | null | undefined>,
  windowDays = 7,
): number {
  const xs = sleepMinutes
    .slice(-windowDays)
    .filter((n): n is number => typeof n === "number" && n > 0);
  if (xs.length < 3) return 0;
  const m = mean(xs);
  if (m <= 0) return 0;
  const variance = mean(xs.map((x) => (x - m) ** 2));
  const stdev = Math.sqrt(variance);
  return Math.max(0, Math.min(1, 1 - stdev / m));
}

// Fraction of the last `windowDays` that have at least one nutrition_log row.
export function loggingConsistency(loggedDates: Set<string>, today: Date, windowDays = 7): number {
  let logged = 0;
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    if (loggedDates.has(key)) logged++;
  }
  return windowDays === 0 ? 0 : logged / windowDays;
}

// Strain proxy in 0..1 based on yesterday's active energy burned vs target.
export function priorDayStrain(
  yesterdayActiveEnergy: number | null | undefined,
  targetEnergy: number,
): number {
  if (yesterdayActiveEnergy == null || targetEnergy <= 0) return 0;
  // 1.5x the daily target → full strain (1.0).
  return Math.max(0, Math.min(1, yesterdayActiveEnergy / (targetEnergy * 1.5)));
}
