import { clamp, clamp01, ratio, round } from "@/lib/scoring/util";

// Wellness/tracking heuristics only — NO medical claims (architecture §16).
// All scores 0..100. Targets come from profiles.targets with sane fallbacks.

export type Targets = {
  steps?: number;
  sleepMinutes?: number;
  activeEnergy?: number;
  workoutMinutes?: number;
  protein?: number;
  calories?: number;
  rhrBaseline?: number;
  hrvBaseline?: number;
};

export const DEFAULT_TARGETS: Required<Targets> = {
  steps: 8000,
  sleepMinutes: 450,
  activeEnergy: 500,
  workoutMinutes: 30,
  protein: 140,
  calories: 2200,
  rhrBaseline: 60,
  hrvBaseline: 60,
};

export function activityScore(
  d: { steps?: number | null; activeEnergy?: number | null; workoutMinutes?: number | null },
  t: Targets = {},
): number {
  const steps = ratio(d.steps, t.steps ?? DEFAULT_TARGETS.steps);
  const energy = ratio(d.activeEnergy, t.activeEnergy ?? DEFAULT_TARGETS.activeEnergy);
  const workout = ratio(d.workoutMinutes, t.workoutMinutes ?? DEFAULT_TARGETS.workoutMinutes);
  return round(clamp(100 * (0.5 * steps + 0.3 * energy + 0.2 * workout), 0, 100));
}

export function nutritionScore(
  d: { protein?: number | null; calories?: number | null; loggingConsistency7d?: number },
  t: Targets = {},
): number {
  const protein = ratio(d.protein, t.protein ?? DEFAULT_TARGETS.protein);
  const calTarget = t.calories ?? DEFAULT_TARGETS.calories;
  const calWithin =
    d.calories == null ? 0 : clamp01(1 - Math.abs(d.calories - calTarget) / calTarget);
  const consistency = clamp01(d.loggingConsistency7d ?? 0);
  return round(clamp(100 * (0.4 * protein + 0.35 * calWithin + 0.25 * consistency), 0, 100));
}

export function recoveryScore(
  d: {
    sleepMinutes?: number | null;
    sleepConsistency?: number; // 0..1
    hrv?: number | null;
    restingHeartRate?: number | null;
    priorDayStrain?: number; // 0..1
  },
  t: Targets = {},
): number {
  const sleep = ratio(d.sleepMinutes, t.sleepMinutes ?? DEFAULT_TARGETS.sleepMinutes);
  const consistency = clamp01(d.sleepConsistency ?? 0);
  const hrvBase = t.hrvBaseline ?? DEFAULT_TARGETS.hrvBaseline;
  const hrv = d.hrv == null ? 0.5 : clamp01(d.hrv / hrvBase);
  const rhrBase = t.rhrBaseline ?? DEFAULT_TARGETS.rhrBaseline;
  const rhr =
    d.restingHeartRate == null ? 0.5 : clamp01(1 - Math.max(0, (d.restingHeartRate - rhrBase) / rhrBase));
  const base = 100 * (0.4 * sleep + 0.2 * consistency + 0.2 * hrv + 0.2 * rhr);
  const strainPenalty = clamp01(d.priorDayStrain ?? 0) * 10;
  return round(clamp(base - strainPenalty, 0, 100));
}
