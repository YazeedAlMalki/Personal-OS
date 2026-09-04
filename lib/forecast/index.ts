import { DAY_MS, clamp01, daysUntil, mean, parseDate, round } from "@/lib/scoring/util";

// Heuristic forecasters (architecture §9.2). Each returns a number/label + reason.
// Deterministic; an upgrade to a statistical/model approach can replace one function
// without touching callers.

export const THRESHOLDS = {
  focusHoursPerDay: 8,
  goalOnTrackGap: -10, // progress may lag expected by up to 10pts and still be "on track"
  goalAtRiskGap: -25,
  trendDays: 7,
};

// Least-squares slope over a series indexed 0..n-1 (units per step).
export function trendSlope(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(series);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    const y = series[i] ?? 0;
    num += (i - xMean) * (y - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}

// True when the last `n` points are all below target (e.g. 3 nights low sleep).
export function consecutiveBelow(series: number[], target: number, n: number): boolean {
  if (series.length < n) return false;
  return series.slice(-n).every((v) => v < target);
}

export function deadlineMissRisk(input: {
  dueDate?: string | null;
  status: string;
  estimatedMinutes?: number | null;
  minutesLogged?: number | null;
  now?: Date;
}): { risk: number; reason: string } {
  const now = input.now ?? new Date();
  if (input.status === "done") return { risk: 0, reason: "Done." };
  const dueDays = daysUntil(input.dueDate ?? null, now);
  if (dueDays === null) return { risk: 0.1, reason: "No due date." };
  if (dueDays < 0) return { risk: 1, reason: "Overdue." };

  const remainingMin = Math.max(0, (input.estimatedMinutes ?? 0) - (input.minutesLogged ?? 0));
  const hoursAvailable = dueDays * THRESHOLDS.focusHoursPerDay;
  let risk = hoursAvailable <= 0 ? 1 : clamp01(remainingMin / 60 / hoursAvailable);
  if (dueDays <= 2 && input.status === "todo") risk = Math.max(risk, 0.6);
  if (input.status === "blocked") risk = Math.max(risk, 0.7);

  const reason =
    dueDays <= 2 ? `Due in ${round(dueDays, 1)}d, status ${input.status}.` : `Due in ${round(dueDays, 1)}d.`;
  return { risk: round(clamp01(risk), 2), reason };
}

export type Trajectory = "on_track" | "at_risk" | "off_track" | "no_deadline";

export function goalTrajectory(input: {
  progress: number; // 0..100
  deadline?: string | null;
  createdAt?: string | null;
  now?: Date;
}): Trajectory {
  const now = input.now ?? new Date();
  const deadline = parseDate(input.deadline ?? null);
  if (!deadline) return "no_deadline";
  if (deadline.getTime() < now.getTime() && input.progress < 100) return "off_track";

  const start = parseDate(input.createdAt ?? null);
  const totalDays = start ? Math.max(1, (deadline.getTime() - start.getTime()) / DAY_MS) : 30;
  const elapsed = start
    ? clamp01((now.getTime() - start.getTime()) / DAY_MS / totalDays)
    : 0.5;
  const gap = input.progress - elapsed * 100;
  if (gap >= THRESHOLDS.goalOnTrackGap) return "on_track";
  if (gap >= THRESHOLDS.goalAtRiskGap) return "at_risk";
  return "off_track";
}

export function pipelineValue(
  opps: { expected_value?: number | null; status: string }[],
): number {
  const active = new Set(["new", "researching", "contacted", "negotiating", "waiting"]);
  let sum = 0;
  for (const o of opps) if (active.has(o.status)) sum += o.expected_value ?? 0;
  return round(sum, 2);
}

export function riskExposure(
  risks: { risk_score?: number | null; status: string }[],
): { total: number; unmitigatedHigh: number } {
  let total = 0;
  let unmitigatedHigh = 0;
  for (const r of risks) {
    if (r.status === "closed") continue;
    const s = r.risk_score ?? 0;
    total += s;
    if (s >= 12) unmitigatedHigh += 1;
  }
  return { total, unmitigatedHigh };
}

// Task completion risk — logistic-ish blend of priority, postponements, and
// days-to-due. Caller still owns the decision to flag (see THRESHOLDS).
export function taskCompletionRisk(input: {
  priorityScore?: number | null; // 0..100
  postponeCount?: number | null;
  dueDate?: string | null;
  status: string;
  now?: Date;
}): { risk: number; reason: string } {
  const now = input.now ?? new Date();
  if (input.status === "done") return { risk: 0, reason: "Done." };
  const dueDays = daysUntil(input.dueDate ?? null, now);
  const dueComp =
    dueDays == null ? 0.2 : dueDays < 0 ? 1 : clamp01(1 / (1 + dueDays / 3));
  const postComp = clamp01((input.postponeCount ?? 0) / 5);
  const prioComp = clamp01((input.priorityScore ?? 0) / 100);
  // Postponements + tight due dates raise risk; high priority is *protective*
  // because the user is more likely to attend to it.
  let risk = 0.45 * dueComp + 0.35 * postComp - 0.2 * prioComp;
  if (input.status === "blocked") risk = Math.max(risk, 0.7);
  risk = clamp01(risk);
  const parts: string[] = [];
  if (dueDays != null && dueDays >= 0 && dueDays < 3) parts.push(`due in ${round(dueDays, 1)}d`);
  if (dueDays != null && dueDays < 0) parts.push("overdue");
  if ((input.postponeCount ?? 0) >= 2) parts.push(`postponed ${input.postponeCount}×`);
  const reason = parts.length ? parts.join(", ") : "Routine.";
  return { risk: round(risk, 2), reason };
}

// Sleep trend — 7-day rolling slope (min/day) + 3-night consecutive check.
export function sleepTrend(
  series: { date: string; sleep_minutes?: number | null }[],
): {
  slope: number;
  threeBelow: boolean;
  target: number;
  avg7: number | null;
} {
  const target = 7 * 60;
  const last7 = series
    .slice(-7)
    .map((d) => d.sleep_minutes ?? 0)
    .filter((v) => v > 0);
  const slope = round(trendSlope(last7), 2);
  const last3 = series.slice(-3).map((d) => d.sleep_minutes ?? 0);
  const threeBelow = last3.length === 3 && last3.every((v) => v < target);
  const avg7 = last7.length ? round(mean(last7), 0) : null;
  return { slope, threeBelow, target, avg7 };
}

// Step trend — 7-day rolling avg vs target.
export function stepTrend(
  series: { date: string; steps?: number | null }[],
  target = 8000,
): { avg7: number; pctOfTarget: number; slope: number } {
  const last7 = series.slice(-7).map((d) => d.steps ?? 0);
  const avg7 = last7.length ? round(mean(last7), 0) : 0;
  return {
    avg7,
    pctOfTarget: target > 0 ? round(avg7 / target, 2) : 0,
    slope: round(trendSlope(last7), 2),
  };
}

// Weight trend — 30-day slope (kg/day) for direction; convert to kg/week
// for human-readable copy.
export function weightTrend(
  series: { date: string; weight_kg?: number | null }[],
): { slopePerWeek: number; latest: number | null } {
  const points = series
    .slice(-30)
    .map((d) => d.weight_kg)
    .filter((v): v is number => typeof v === "number");
  if (points.length < 2)
    return { slopePerWeek: 0, latest: points[points.length - 1] ?? null };
  return {
    slopePerWeek: round(trendSlope(points) * 7, 2),
    latest: points[points.length - 1] ?? null,
  };
}

// Workout consistency — sessions/week vs target. Streak = consecutive weeks
// at or above target.
export function workoutConsistency(
  workouts: { date: string }[],
  target = 3,
  weeksBack = 8,
  now: Date = new Date(),
): { sessionsPerWeek: number; streakWeeks: number; latestWeekCount: number } {
  const weekBuckets = new Map<string, number>();
  for (const w of workouts) {
    const d = new Date(w.date.length === 10 ? w.date + "T00:00:00Z" : w.date);
    if (Number.isNaN(d.getTime())) continue;
    const ageDays = Math.floor((now.getTime() - d.getTime()) / DAY_MS);
    if (ageDays < 0 || ageDays > weeksBack * 7) continue;
    const weekKey = String(Math.floor(ageDays / 7));
    weekBuckets.set(weekKey, (weekBuckets.get(weekKey) ?? 0) + 1);
  }
  const counts: number[] = [];
  for (let w = 0; w < weeksBack; w++) {
    counts.push(weekBuckets.get(String(w)) ?? 0);
  }
  const sessionsPerWeek = counts.length ? round(mean(counts), 1) : 0;
  let streak = 0;
  for (const c of counts) {
    if (c >= target) streak++;
    else break;
  }
  return {
    sessionsPerWeek,
    streakWeeks: streak,
    latestWeekCount: counts[0] ?? 0,
  };
}

// Opportunity pipeline value with week-over-week delta — requires snapshots
// across time; the caller can fall back to single-snapshot value.
export function pipelineDelta(
  thisWeek: number,
  lastWeek: number,
): { deltaPct: number; direction: "up" | "down" | "flat" } {
  if (lastWeek <= 0)
    return { deltaPct: 0, direction: thisWeek > 0 ? "up" : "flat" };
  const deltaPct = round((thisWeek - lastWeek) / lastWeek, 2);
  return {
    deltaPct,
    direction:
      Math.abs(deltaPct) < 0.02 ? "flat" : deltaPct > 0 ? "up" : "down",
  };
}
