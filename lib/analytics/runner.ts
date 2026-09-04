import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  MIN_PAIRS,
  pairByDate,
  summarizeCorrelation,
} from "@/lib/analytics/correlate";
import type { Insight } from "@/lib/chief/types";
import { DAY_MS } from "@/lib/scoring/util";

type DatedPoint = { date: string; value: number };

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function severityForRho(rho: number | null): "info" | "low" | "medium" {
  if (rho == null) return "info";
  const a = Math.abs(rho);
  if (a >= 0.6) return "medium";
  if (a >= 0.4) return "low";
  return "info";
}

// Compute and persist all eight cross-domain correlations from spec §9.3.
// Pairs (data-driven, never causal):
//   1. sleep × task-completion
//   2. steps × mood
//   3. workouts × energy
//   4. calendar-load × stress
//   5. protein × training consistency
//   6. time-spent × goal-progress
//   7. follow-ups × opportunity movement
//   8. decision assumption quality × outcome
export async function runAnalytics(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<Insight[]> {
  const since = isoDay(new Date(now.getTime() - 90 * DAY_MS));

  const [
    health,
    tasks,
    journal,
    workouts,
    nutrition,
    timeLogs,
    contacts,
    opps,
    goals,
    decisions,
  ] = await Promise.all([
    supabase
      .from("health_daily")
      .select("date,sleep_minutes,steps")
      .gte("date", since)
      .order("date", { ascending: true })
      .limit(120),
    supabase
      .from("tasks")
      .select("id,completed_at,status")
      .eq("status", "done")
      .gte("completed_at", new Date(now.getTime() - 90 * DAY_MS).toISOString())
      .limit(2000),
    supabase
      .from("journal_entries")
      .select("entry_date,mood,energy_level,stress_level")
      .gte("entry_date", since)
      .order("entry_date", { ascending: true })
      .limit(120),
    supabase
      .from("workouts")
      .select("date")
      .gte("date", since)
      .limit(500),
    supabase
      .from("nutrition_logs")
      .select("date,protein")
      .gte("date", since)
      .limit(500),
    supabase
      .from("time_logs")
      .select("start_time,end_time,goal_id,project_id,task_id")
      .gte("start_time", new Date(now.getTime() - 90 * DAY_MS).toISOString())
      .limit(2000),
    supabase
      .from("contacts")
      .select("id,last_contacted_at")
      .gte("last_contacted_at", new Date(now.getTime() - 90 * DAY_MS).toISOString())
      .limit(2000),
    supabase
      .from("opportunities")
      .select("id,status,updated_at")
      .gte("updated_at", new Date(now.getTime() - 90 * DAY_MS).toISOString())
      .limit(2000),
    supabase
      .from("goals")
      .select("id,progress_percentage,updated_at,created_at")
      .limit(500),
    supabase
      .from("decisions")
      .select("id,status,assumption_confidence,outcome_score,outcome_reviewed_at")
      .not("outcome_score", "is", null)
      .not("assumption_confidence", "is", null)
      .limit(500),
  ]);

  // ---- Build dated series ----
  // Sleep per night (date keyed).
  const sleep: DatedPoint[] = (health.data ?? [])
    .filter((h) => typeof h.sleep_minutes === "number")
    .map((h) => ({ date: h.date, value: h.sleep_minutes as number }));
  const steps: DatedPoint[] = (health.data ?? [])
    .filter((h) => typeof h.steps === "number")
    .map((h) => ({ date: h.date, value: h.steps as number }));

  // Tasks completed per day.
  const tasksByDay = new Map<string, number>();
  for (const t of tasks.data ?? []) {
    if (!t.completed_at) continue;
    const day = isoDay(new Date(t.completed_at));
    tasksByDay.set(day, (tasksByDay.get(day) ?? 0) + 1);
  }
  const tasksDone: DatedPoint[] = Array.from(tasksByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Mood / energy / stress from journal_entries.
  const mood: DatedPoint[] = [];
  const energy: DatedPoint[] = [];
  const stress: DatedPoint[] = [];
  for (const j of journal.data ?? []) {
    if (j.mood != null) mood.push({ date: j.entry_date, value: j.mood });
    if (j.energy_level != null)
      energy.push({ date: j.entry_date, value: j.energy_level });
    if (j.stress_level != null)
      stress.push({ date: j.entry_date, value: j.stress_level });
  }

  // Workouts per day (0/1+).
  const workoutByDay = new Map<string, number>();
  for (const w of workouts.data ?? []) {
    workoutByDay.set(w.date, (workoutByDay.get(w.date) ?? 0) + 1);
  }
  const workoutsDaily: DatedPoint[] = Array.from(workoutByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Protein per day.
  const proteinByDay = new Map<string, number>();
  for (const n of nutrition.data ?? []) {
    if (n.protein == null) continue;
    proteinByDay.set(
      n.date,
      (proteinByDay.get(n.date) ?? 0) + (n.protein as number),
    );
  }
  const protein: DatedPoint[] = Array.from(proteinByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Calendar load: from time_logs (sum of minutes per day) — proxy for meeting load.
  const calLoadByDay = new Map<string, number>();
  for (const tl of timeLogs.data ?? []) {
    if (!tl.start_time || !tl.end_time) continue;
    const start = new Date(tl.start_time);
    const end = new Date(tl.end_time);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const day = isoDay(start);
    const mins = Math.max(0, (end.getTime() - start.getTime()) / 60000);
    calLoadByDay.set(day, (calLoadByDay.get(day) ?? 0) + mins);
  }
  const calendarLoad: DatedPoint[] = Array.from(calLoadByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Follow-ups per day (contacts.last_contacted_at touched).
  const followByDay = new Map<string, number>();
  for (const c of contacts.data ?? []) {
    if (!c.last_contacted_at) continue;
    const day = isoDay(new Date(c.last_contacted_at));
    followByDay.set(day, (followByDay.get(day) ?? 0) + 1);
  }
  const followUps: DatedPoint[] = Array.from(followByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Opportunity movement per day (opportunity rows updated that day).
  const oppByDay = new Map<string, number>();
  for (const o of opps.data ?? []) {
    if (!o.updated_at) continue;
    const day = isoDay(new Date(o.updated_at));
    oppByDay.set(day, (oppByDay.get(day) ?? 0) + 1);
  }
  const oppMoves: DatedPoint[] = Array.from(oppByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Goal progress: per-day delta. With only current progress + updated_at this is coarse;
  // we report the *amount of recent movement* per day (rows touched).
  const goalByDay = new Map<string, number>();
  for (const g of goals.data ?? []) {
    if (!g.updated_at) continue;
    const day = isoDay(new Date(g.updated_at));
    goalByDay.set(day, (goalByDay.get(day) ?? 0) + (g.progress_percentage ?? 0));
  }
  const goalActivity: DatedPoint[] = Array.from(goalByDay.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, value }));

  // Time spent (minutes/day on goal/project work).
  const timeSpent: DatedPoint[] = calendarLoad; // proxy: same series

  // ---- Build insights via correlation summaries ----
  const out: Insight[] = [];

  type Pair = {
    label: string;
    a: DatedPoint[];
    b: DatedPoint[];
    labelA: string;
    labelB: string;
  };
  const pairs: Pair[] = [
    { label: "sleep_vs_tasks_done", labelA: "sleep", labelB: "tasks completed", a: sleep, b: tasksDone },
    { label: "steps_vs_mood", labelA: "steps", labelB: "mood", a: steps, b: mood },
    { label: "workouts_vs_energy", labelA: "workouts", labelB: "energy", a: workoutsDaily, b: energy },
    { label: "calendar_vs_stress", labelA: "calendar load", labelB: "stress", a: calendarLoad, b: stress },
    { label: "protein_vs_workouts", labelA: "protein", labelB: "training consistency", a: protein, b: workoutsDaily },
    { label: "time_vs_goal_progress", labelA: "time spent", labelB: "goal progress", a: timeSpent, b: goalActivity },
    { label: "followups_vs_opps", labelA: "follow-ups", labelB: "opportunity movement", a: followUps, b: oppMoves },
  ];

  for (const p of pairs) {
    const { xs, ys } = pairByDate(p.a, p.b);
    const r = summarizeCorrelation(p.labelA, p.labelB, xs, ys);
    // Only persist meaningful or under-sampled (info) results — skip empty silence.
    if (r.n === 0) continue;
    out.push({
      insight_type: "correlation",
      title: r.label,
      body: r.sentence,
      severity: severityForRho(r.rho),
      related_table: "system",
      // Use Math.abs(rho) clamped 0..1 as confidence; null → 0.
      confidence_score: r.rho == null ? Math.min(0.5, r.n / MIN_PAIRS) : Math.min(1, Math.abs(r.rho)),
    });
  }

  // 8th pair — decision assumption confidence vs outcome score.
  // Not date-keyed; one observation per reviewed decision. Run summarize
  // directly over the matched pairs.
  const dq = (decisions.data ?? []).filter(
    (d) =>
      typeof d.assumption_confidence === "number" &&
      typeof d.outcome_score === "number",
  );
  if (dq.length > 0) {
    const xs = dq.map((d) => d.assumption_confidence as number);
    const ys = dq.map((d) => d.outcome_score as number);
    const r = summarizeCorrelation(
      "assumption confidence",
      "actual outcome",
      xs,
      ys,
    );
    out.push({
      insight_type: "correlation",
      title: "decisions: confidence vs outcome",
      body: r.sentence,
      severity: severityForRho(r.rho),
      related_table: "decisions",
      confidence_score:
        r.rho == null
          ? Math.min(0.5, r.n / MIN_PAIRS)
          : Math.min(1, Math.abs(r.rho)),
    });
  }

  return out;
}
