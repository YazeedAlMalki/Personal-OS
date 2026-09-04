import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { FORECAST_THRESHOLDS } from "@/lib/forecast/config";
import {
  deadlineMissRisk,
  goalTrajectory,
  pipelineDelta,
  pipelineValue,
  riskExposure,
  sleepTrend,
  stepTrend,
  taskCompletionRisk,
  weightTrend,
  workoutConsistency,
  type Trajectory,
} from "@/lib/forecast";
import type { Insight } from "@/lib/chief/types";
import { DAY_MS, round } from "@/lib/scoring/util";

// Read inputs the forecast functions need, run them, and convert the results to
// ai_insights rows (insight_type = "forecast"). All decisions are deterministic;
// thresholds live in lib/forecast/config.ts.
export async function runForecasts(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<Insight[]> {
  const since = new Date(now.getTime() - 30 * DAY_MS).toISOString().slice(0, 10);
  const sincePrev = new Date(now.getTime() - 14 * DAY_MS).toISOString();

  const [tasks, goals, opps, risks, health, workouts, finance] = await Promise.all([
    supabase
      .from("tasks")
      .select(
        "id,title,status,priority_score,postpone_count,due_date,estimated_minutes",
      )
      .neq("status", "done")
      .limit(500),
    supabase
      .from("goals")
      .select("id,title,status,progress_percentage,deadline,created_at")
      .eq("status", "active")
      .limit(200),
    supabase
      .from("opportunities")
      .select("id,title,status,expected_value,updated_at")
      .limit(500),
    supabase
      .from("risks")
      .select("id,title,status,risk_score,mitigation_plan")
      .limit(500),
    supabase
      .from("health_daily")
      .select("date,sleep_minutes,steps,weight_kg")
      .gte("date", since)
      .order("date", { ascending: true })
      .limit(60),
    supabase
      .from("workouts")
      .select("date")
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(200),
    supabase
      .from("finance_snapshots")
      .select("date,net_worth")
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(20),
  ]);

  const out: Insight[] = [];

  // ---------------- Task deadline + completion risk ----------------
  for (const t of tasks.data ?? []) {
    const dm = deadlineMissRisk({
      dueDate: t.due_date,
      status: t.status,
      estimatedMinutes: t.estimated_minutes,
      minutesLogged: 0,
      now,
    });
    if (dm.risk >= FORECAST_THRESHOLDS.deadlineMissFlag) {
      out.push({
        insight_type: "forecast",
        title: `Likely to miss: ${t.title}`,
        body: `Deadline-miss risk ${Math.round(dm.risk * 100)}% — ${dm.reason}`,
        severity: dm.risk >= 0.85 ? "high" : "medium",
        related_table: "tasks",
        related_record_id: t.id,
        confidence_score: dm.risk,
      });
      continue; // don't double-flag with completion risk
    }
    const tc = taskCompletionRisk({
      priorityScore: t.priority_score,
      postponeCount: t.postpone_count,
      dueDate: t.due_date,
      status: t.status,
      now,
    });
    if (tc.risk >= FORECAST_THRESHOLDS.taskRiskFlag) {
      out.push({
        insight_type: "forecast",
        title: `At-risk task: ${t.title}`,
        body: `Completion risk ${Math.round(tc.risk * 100)}% — ${tc.reason}.`,
        severity: tc.risk >= 0.85 ? "high" : "medium",
        related_table: "tasks",
        related_record_id: t.id,
        confidence_score: tc.risk,
      });
    }
  }

  // ---------------- Goal trajectory ----------------
  for (const g of goals.data ?? []) {
    const traj: Trajectory = goalTrajectory({
      progress: g.progress_percentage ?? 0,
      deadline: g.deadline,
      createdAt: g.created_at,
      now,
    });
    if (traj === "off_track") {
      out.push({
        insight_type: "forecast",
        title: `Goal off track: ${g.title}`,
        body: `At ${g.progress_percentage ?? 0}% progress with deadline ${g.deadline ?? "?"} — the trend won't catch up without intervention.`,
        severity: "high",
        related_table: "goals",
        related_record_id: g.id,
        confidence_score: 0.8,
      });
    } else if (traj === "at_risk") {
      out.push({
        insight_type: "forecast",
        title: `Goal at risk: ${g.title}`,
        body: `Progress is trailing the deadline pace. Add a scheduled push.`,
        severity: "medium",
        related_table: "goals",
        related_record_id: g.id,
        confidence_score: 0.65,
      });
    }
  }

  // ---------------- Sleep + step trends ----------------
  const sleep = sleepTrend(health.data ?? []);
  if (sleep.threeBelow) {
    out.push({
      insight_type: "forecast",
      title: "Sleep deficit building",
      body: `3 nights below target. 7-day avg ${sleep.avg7 ?? "?"} min.`,
      severity: "medium",
      related_table: "health_daily",
      confidence_score: 0.8,
    });
  }
  const steps = stepTrend(health.data ?? [], FORECAST_THRESHOLDS.stepsLow);
  if (steps.pctOfTarget > 0 && steps.pctOfTarget < 0.8) {
    out.push({
      insight_type: "forecast",
      title: "Activity below target",
      body: `7-day avg ${steps.avg7.toLocaleString()} steps (${Math.round(steps.pctOfTarget * 100)}% of target).`,
      severity: "low",
      related_table: "health_daily",
      confidence_score: 0.7,
    });
  }

  // ---------------- Weight trend (info, no severity bump) ----------------
  const weight = weightTrend(health.data ?? []);
  if (weight.latest != null && Math.abs(weight.slopePerWeek) >= 0.5) {
    out.push({
      insight_type: "forecast",
      title: `Weight trend ${weight.slopePerWeek >= 0 ? "up" : "down"} ~${Math.abs(weight.slopePerWeek)}kg/wk`,
      body: `30-day slope. Latest ${weight.latest}kg.`,
      severity: "info",
      related_table: "health_daily",
      confidence_score: 0.6,
    });
  }

  // ---------------- Workout consistency ----------------
  const wo = workoutConsistency(
    workouts.data ?? [],
    FORECAST_THRESHOLDS.workoutSessionsPerWeekTarget,
    8,
    now,
  );
  if (wo.sessionsPerWeek < FORECAST_THRESHOLDS.workoutSessionsPerWeekTarget * 0.7) {
    out.push({
      insight_type: "forecast",
      title: "Workout cadence slipping",
      body: `Averaging ${wo.sessionsPerWeek} sessions/week vs target ${FORECAST_THRESHOLDS.workoutSessionsPerWeekTarget}. Streak ${wo.streakWeeks}wk.`,
      severity: "low",
      related_table: "workouts",
      confidence_score: 0.65,
    });
  }

  // ---------------- Pipeline value + WoW delta ----------------
  const total = pipelineValue(opps.data ?? []);
  // Crude WoW: this-week active value vs week-old active value approximated by
  // the value of opps updated > 14d ago (a stand-in until we snapshot weekly).
  const thisWeekVal = total;
  const lastWeekVal = (opps.data ?? [])
    .filter((o) => o.updated_at && o.updated_at < sincePrev)
    .reduce((sum, o) => sum + (o.expected_value ?? 0), 0);
  if (thisWeekVal > 0 && lastWeekVal > 0) {
    const d = pipelineDelta(thisWeekVal, lastWeekVal);
    if (d.direction === "down" && Math.abs(d.deltaPct) >= FORECAST_THRESHOLDS.pipelineWowDropFlag) {
      out.push({
        insight_type: "forecast",
        title: `Pipeline shrinking ${Math.round(Math.abs(d.deltaPct) * 100)}%`,
        body: `Active opportunity value at ~${Math.round(thisWeekVal).toLocaleString()}, down from ~${Math.round(lastWeekVal).toLocaleString()}.`,
        severity: "medium",
        related_table: "opportunities",
        confidence_score: 0.6,
      });
    }
  }

  // ---------------- Risk exposure ----------------
  const re = riskExposure(risks.data ?? []);
  if (re.unmitigatedHigh > 0) {
    out.push({
      insight_type: "forecast",
      title: `Risk exposure: ${re.total} pts, ${re.unmitigatedHigh} unmitigated high`,
      body: `Open risks total ${re.total} score; ${re.unmitigatedHigh} are ≥${FORECAST_THRESHOLDS.riskExposureHighScore} without a mitigation plan.`,
      severity: "high",
      related_table: "risks",
      confidence_score: 0.7,
    });
  }

  // ---------------- Net-worth trend (info) ----------------
  const nw = (finance.data ?? [])
    .map((f) => f.net_worth)
    .filter((v): v is number => typeof v === "number");
  if (nw.length >= 2) {
    const first = nw[nw.length - 1] ?? 0;
    const last = nw[0] ?? 0;
    if (first !== 0) {
      const pct = round((last - first) / Math.abs(first), 2);
      if (Math.abs(pct) >= 0.05) {
        out.push({
          insight_type: "forecast",
          title: `Net worth ${pct >= 0 ? "up" : "down"} ${Math.round(pct * 100)}% over snapshot window`,
          body: `Latest ${Math.round(last).toLocaleString()}, earliest in window ${Math.round(first).toLocaleString()}.`,
          severity: "info",
          related_table: "finance_snapshots",
          confidence_score: 0.6,
        });
      }
    }
  }

  return out;
}
