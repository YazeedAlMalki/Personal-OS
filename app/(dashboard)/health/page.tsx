import { createClient } from "@/lib/supabase/server";
import { Panel } from "@/components/ui/Panel";
import { MetricCard } from "@/components/health/MetricCard";
import { ManualEntry } from "@/components/health/ManualEntry";
import { WorkoutEntry } from "@/components/health/WorkoutEntry";
import { NutritionEntry } from "@/components/health/NutritionEntry";
import { ModuleForecasts } from "@/components/insights/ModuleForecasts";
import { listHealthDaily, listWorkouts, loadTargets } from "@/lib/domains/health";
import { DAY_MS } from "@/lib/scoring/util";
import type { HealthDailyRow } from "@/lib/db/health-types";

function fmt(n: number | null | undefined, dp = 0): string | null {
  if (n === null || n === undefined || !Number.isFinite(n)) return null;
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Align the last 14 days into a fixed-length array; null entries are missing days.
function buildSeries<K extends keyof HealthDailyRow>(
  rows: HealthDailyRow[],
  key: K,
  endDate: Date,
  days = 14,
): Array<number | null> {
  const byDate = new Map(rows.map((r) => [r.date, r] as const));
  const out: Array<number | null> = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(endDate.getTime() - i * DAY_MS);
    const row = byDate.get(dateKey(d));
    const v = row ? (row[key] as unknown) : null;
    out.push(typeof v === "number" ? v : v == null ? null : Number(v));
  }
  return out;
}

export default async function HealthPage() {
  const supabase = await createClient();
  const today = new Date();
  const todayKey = dateKey(today);
  const since = dateKey(new Date(today.getTime() - 30 * DAY_MS));

  const [rows, workouts, targets] = await Promise.all([
    listHealthDaily(supabase, since),
    listWorkouts(supabase, since),
    loadTargets(supabase),
  ]);
  const todayRow = rows.find((r) => r.date === todayKey) ?? null;

  // Series — last 14 days.
  const sleepS = buildSeries(rows, "sleep_minutes", today);
  const stepsS = buildSeries(rows, "steps", today);
  const hrvS = buildSeries(rows, "hrv", today);
  const rhrS = buildSeries(rows, "resting_heart_rate", today);
  const weightS = buildSeries(rows, "weight", today);
  const recoveryS = buildSeries(rows, "recovery_score", today);
  const activityS = buildSeries(rows, "activity_score", today);
  const nutritionS = buildSeries(rows, "nutrition_score", today);

  const sleepHours = todayRow?.sleep_minutes != null
    ? Math.round((todayRow.sleep_minutes / 60) * 10) / 10
    : null;

  const stepsTarget = targets.steps ?? 8000;
  const sleepTargetH = Math.round(((targets.sleepMinutes ?? 450) / 60) * 10) / 10;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-4">Health & fitness</h1>
          <p className="text-sm text-ink-3">
            {todayRow ? `Last update: ${todayRow.source}` : "No reading yet today."}
          </p>
        </div>
        <p className="text-xs text-ink-3">Wellness tracking — not medical advice.</p>
      </header>

      <ModuleForecasts tables={["health_daily", "workouts"]} title="Health trends" />

      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <MetricCard label="Recovery" value={todayRow?.recovery_score} series={recoveryS} hint="0–100" />
        <MetricCard label="Activity" value={todayRow?.activity_score} series={activityS} hint="0–100" />
        <MetricCard label="Nutrition" value={todayRow?.nutrition_score} series={nutritionS} hint="0–100" />
      </section>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard
          label="Sleep"
          value={sleepHours}
          unit={`h / ${sleepTargetH}h`}
          series={sleepS}
        />
        <MetricCard
          label="Steps"
          value={fmt(todayRow?.steps)}
          unit={`/ ${stepsTarget.toLocaleString()}`}
          series={stepsS}
        />
        <MetricCard label="HRV" value={fmt(todayRow?.hrv, 1)} unit="ms" series={hrvS} />
        <MetricCard label="Resting HR" value={fmt(todayRow?.resting_heart_rate)} unit="bpm" series={rhrS} />
        <MetricCard label="Weight" value={fmt(todayRow?.weight, 1)} unit="kg" series={weightS} />
        <MetricCard label="Active kcal" value={fmt(todayRow?.active_energy_burned)} unit="kcal" />
        <MetricCard label="Workouts (today)" value={fmt(todayRow?.workouts_count)} unit="sessions" />
        <MetricCard label="VO₂ max" value={fmt(todayRow?.vo2_max, 1)} unit="ml/kg/min" />
      </section>

      <Panel title="Log today">
        <ManualEntry />
      </Panel>

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="Log a workout">
          <WorkoutEntry />
        </Panel>
        <Panel title="Log a meal">
          <NutritionEntry />
        </Panel>
      </div>

      <Panel title="Recent workouts">
        {workouts.length === 0 ? (
          <p className="text-sm text-ink-3">No workouts logged in the last 30 days.</p>
        ) : (
          <ul className="divide-y divide-line">
            {workouts.slice(0, 10).map((w) => (
              <li key={w.id} className="flex items-center justify-between py-2 text-sm">
                <div className="text-ink-4">
                  {w.workout_type ?? "Workout"}{" "}
                  <span className="text-xs text-ink-3">· {w.date}</span>
                </div>
                <div className="font-mono text-xs text-ink-3">
                  {w.duration_minutes ?? "—"} min
                  {w.calories_burned ? ` · ${Math.round(w.calories_burned)} kcal` : ""}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
