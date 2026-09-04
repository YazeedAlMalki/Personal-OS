import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  HealthDailyCreate,
  HealthkitIngest,
  NutritionCreate,
  WorkoutCreate,
} from "@/lib/security/validation";
import type {
  HealthDailyRow,
  NutritionLogRow,
  WorkoutRow,
} from "@/lib/db/health-types";
import type { MappedWorkout } from "@/lib/domains/health-auto-export";
import {
  activityScore,
  nutritionScore,
  recoveryScore,
  type Targets,
} from "@/lib/scoring/health";
import {
  computeBaselines,
  loggingConsistency,
  priorDayStrain,
  sleepConsistency,
} from "@/lib/scoring/baselines";
import { DAY_MS } from "@/lib/scoring/util";

// Pull the user's targets from profiles.targets jsonb. Returns {} if absent —
// scoring functions then fall back to DEFAULT_TARGETS.
export async function loadTargets(supabase: SupabaseClient): Promise<Targets> {
  const { data } = await supabase
    .from("profiles")
    .select("targets")
    .single();
  const t = (data?.targets ?? {}) as Targets;
  return t;
}

// List health_daily rows in [sinceDate, today], ascending.
export async function listHealthDaily(
  supabase: SupabaseClient,
  sinceDate: string,
): Promise<HealthDailyRow[]> {
  const { data, error } = await supabase
    .from("health_daily")
    .select("*")
    .gte("date", sinceDate)
    .order("date", { ascending: true });
  if (error) throw error;
  return (data ?? []) as HealthDailyRow[];
}

export async function getHealthDay(
  supabase: SupabaseClient,
  date: string,
): Promise<HealthDailyRow | null> {
  const { data } = await supabase
    .from("health_daily")
    .select("*")
    .eq("date", date)
    .maybeSingle();
  return (data ?? null) as HealthDailyRow | null;
}

// Upsert one health_daily row by (user_id, date). user_id comes from the
// column default (auth.uid()) so the client never sets it. After the upsert
// we recompute the three derived scores for the affected date.
export async function upsertHealthDaily(
  supabase: SupabaseClient,
  input: HealthDailyCreate,
): Promise<HealthDailyRow> {
  const payload = { ...input, updated_at: new Date().toISOString() };
  const { data, error } = await supabase
    .from("health_daily")
    .upsert(payload, { onConflict: "user_id,date" })
    .select()
    .single();
  if (error) throw error;
  const row = data as HealthDailyRow;
  await recomputeScoresForDate(supabase, row.date);
  return row;
}

// Service-role variant used by /api/ingest/healthkit. The caller MUST pass
// userId since there's no auth.uid() in that context.
export async function ingestHealthkit(
  supabase: SupabaseClient,
  userId: string,
  body: HealthkitIngest,
): Promise<{ healthDaily: HealthDailyRow; workoutsInserted: number }> {
  const { workouts: w, ...rest } = body;
  // Aggregate workout summary into the health_daily row — but ONLY when the
  // post actually carries workouts. Omitting the keys otherwise keeps the
  // upsert merge-safe: a metrics-only re-post (e.g. Health Auto Export every
  // ~5 min) must not null out counters another path rolled up.
  const payload: Record<string, unknown> = {
    user_id: userId,
    ...rest,
    updated_at: new Date().toISOString(),
  };
  if (w) {
    payload.workouts_count = w.length;
    payload.workout_minutes = w.reduce((s, x) => s + (x.duration_minutes ?? 0), 0);
  }
  const { data, error } = await supabase
    .from("health_daily")
    .upsert(payload, { onConflict: "user_id,date" })
    .select()
    .single();
  if (error) throw error;
  const healthDaily = data as HealthDailyRow;

  let workoutsInserted = 0;
  if (w && w.length > 0) {
    const rows = w.map((x) => ({
      user_id: userId,
      date: body.date,
      source: body.source,
      ...x,
    }));
    const ins = await supabase.from("workouts").insert(rows).select("id");
    if (ins.error) throw ins.error;
    workoutsInserted = ins.data?.length ?? 0;
  }

  await recomputeScoresForDate(supabase, body.date, userId);
  return { healthDaily, workoutsInserted };
}

// Idempotent workout sync for Health Auto Export (service role — explicit
// userId everywhere). HAE re-posts its whole configured window on every
// background run, so a blind insert would duplicate rows every ~5 minutes.
// Identity: each mapped workout carries a stable `sync_key` (start time +
// type) which we store in `notes`; rows whose key already exists are skipped.
// After inserting, workout counters on the affected health_daily rows are
// re-rolled from the DB and scores recomputed.
export async function syncHaeWorkouts(
  supabase: SupabaseClient,
  userId: string,
  workouts: MappedWorkout[],
): Promise<{ inserted: number; skipped: number; dates: string[] }> {
  if (workouts.length === 0) return { inserted: 0, skipped: 0, dates: [] };
  const dates = [...new Set(workouts.map((w) => w.date))].sort();

  const existing = await supabase
    .from("workouts")
    .select("notes")
    .eq("user_id", userId)
    .in("date", dates);
  if (existing.error) throw existing.error;
  const seen = new Set(
    ((existing.data ?? []) as { notes: string | null }[])
      .map((r) => r.notes)
      .filter((n): n is string => typeof n === "string" && n.startsWith("hae:")),
  );

  const rows: Record<string, unknown>[] = [];
  for (const w of workouts) {
    if (seen.has(w.sync_key)) continue;
    seen.add(w.sync_key); // also dedupes within the batch itself
    const { sync_key, ...fields } = w;
    rows.push({ user_id: userId, source: "healthkit", notes: sync_key, ...fields });
  }

  let inserted = 0;
  if (rows.length > 0) {
    const ins = await supabase.from("workouts").insert(rows).select("id");
    if (ins.error) throw ins.error;
    inserted = ins.data?.length ?? 0;
  }

  // Re-roll counters + scores per affected date (all sources, user-scoped).
  for (const date of dates) {
    const day = await supabase
      .from("workouts")
      .select("duration_minutes")
      .eq("user_id", userId)
      .eq("date", date);
    const dayRows = (day.data ?? []) as { duration_minutes: number | null }[];
    await supabase.from("health_daily").upsert(
      {
        user_id: userId,
        date,
        workouts_count: dayRows.length,
        workout_minutes: dayRows.reduce((s, r) => s + (r.duration_minutes ?? 0), 0),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );
    await recomputeScoresForDate(supabase, date, userId);
  }

  return { inserted, skipped: workouts.length - inserted, dates };
}

export async function listWorkouts(
  supabase: SupabaseClient,
  sinceDate: string,
): Promise<WorkoutRow[]> {
  const { data, error } = await supabase
    .from("workouts")
    .select("*")
    .gte("date", sinceDate)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as WorkoutRow[];
}

export async function createWorkout(
  supabase: SupabaseClient,
  input: WorkoutCreate,
): Promise<WorkoutRow> {
  const { data, error } = await supabase
    .from("workouts")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  // Refresh the aggregate counters on the matching health_daily row.
  await rollupWorkoutsIntoHealthDaily(supabase, input.date);
  return data as WorkoutRow;
}

export async function listNutrition(
  supabase: SupabaseClient,
  sinceDate: string,
): Promise<NutritionLogRow[]> {
  const { data, error } = await supabase
    .from("nutrition_logs")
    .select("*")
    .gte("date", sinceDate)
    .order("date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as NutritionLogRow[];
}

export async function createNutritionLog(
  supabase: SupabaseClient,
  input: NutritionCreate,
): Promise<NutritionLogRow> {
  const payload = { ...input, ingredients: input.ingredients ?? [] };
  const { data, error } = await supabase
    .from("nutrition_logs")
    .insert(payload)
    .select()
    .single();
  if (error) throw error;
  // Roll daily macros into health_daily so the score includes them.
  await rollupNutritionIntoHealthDaily(supabase, input.date);
  return data as NutritionLogRow;
}

// Sum the day's workouts and re-write workouts_count + workout_minutes
// into the matching health_daily row (creating one if necessary).
async function rollupWorkoutsIntoHealthDaily(supabase: SupabaseClient, date: string) {
  const { data } = await supabase
    .from("workouts")
    .select("duration_minutes")
    .eq("date", date);
  const rows = (data ?? []) as { duration_minutes: number | null }[];
  const count = rows.length;
  const minutes = rows.reduce((s, r) => s + (r.duration_minutes ?? 0), 0);
  await supabase
    .from("health_daily")
    .upsert(
      {
        date,
        workouts_count: count,
        workout_minutes: minutes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );
  await recomputeScoresForDate(supabase, date);
}

// Sum the day's nutrition_logs into the health_daily row's
// calories_consumed + protein_grams. Carbs/fat are kept per-log only.
async function rollupNutritionIntoHealthDaily(supabase: SupabaseClient, date: string) {
  const { data } = await supabase
    .from("nutrition_logs")
    .select("calories,protein")
    .eq("date", date);
  const rows = (data ?? []) as { calories: number | null; protein: number | null }[];
  const calories = rows.reduce((s, r) => s + (r.calories ?? 0), 0);
  const protein = rows.reduce((s, r) => s + (r.protein ?? 0), 0);
  await supabase
    .from("health_daily")
    .upsert(
      {
        date,
        calories_consumed: calories,
        protein_grams: protein,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,date" },
    );
  await recomputeScoresForDate(supabase, date);
}

// Recompute recovery/activity/nutrition for one day using the user's
// targets + a 30-day window of prior data for baselines/consistency.
// Pass userId when running under the service role (no auth.uid() context).
export async function recomputeScoresForDate(
  supabase: SupabaseClient,
  date: string,
  userId?: string,
): Promise<void> {
  const targets = await loadTargets(supabase);
  const sinceKey = new Date(new Date(date).getTime() - 30 * DAY_MS)
    .toISOString()
    .slice(0, 10);

  // Window of recent rows for baselines + sleep consistency.
  const window = await listHealthDaily(supabase, sinceKey);
  const today = window.find((r) => r.date === date) ?? null;
  if (!today) return; // nothing to score yet

  const yesterday = window.find(
    (r) =>
      r.date ===
      new Date(new Date(date).getTime() - DAY_MS).toISOString().slice(0, 10),
  );

  const baselines = computeBaselines(window, targets);
  const consistency = sleepConsistency(window.map((r) => r.sleep_minutes));

  // Nutrition logging consistency over the last 7 days.
  const nutSinceKey = new Date(new Date(date).getTime() - 7 * DAY_MS)
    .toISOString()
    .slice(0, 10);
  const nut = await supabase
    .from("nutrition_logs")
    .select("date")
    .gte("date", nutSinceKey);
  const loggedDates = new Set<string>((nut.data ?? []).map((r) => r.date as string));
  const logging7d = loggingConsistency(loggedDates, new Date(date));

  const strain = priorDayStrain(yesterday?.active_energy_burned, targets.activeEnergy ?? 500);

  const recovery = recoveryScore(
    {
      sleepMinutes: today.sleep_minutes,
      sleepConsistency: consistency,
      hrv: today.hrv,
      restingHeartRate: today.resting_heart_rate,
      priorDayStrain: strain,
    },
    { ...targets, rhrBaseline: baselines.rhrBaseline, hrvBaseline: baselines.hrvBaseline },
  );
  const activity = activityScore(
    {
      steps: today.steps,
      activeEnergy: today.active_energy_burned,
      workoutMinutes: today.workout_minutes,
    },
    targets,
  );
  const nutrition = nutritionScore(
    {
      protein: today.protein_grams,
      calories: today.calories_consumed,
      loggingConsistency7d: logging7d,
    },
    targets,
  );

  let q = supabase
    .from("health_daily")
    .update({
      recovery_score: recovery,
      activity_score: activity,
      nutrition_score: nutrition,
      updated_at: new Date().toISOString(),
    })
    .eq("date", date);
  if (userId) q = q.eq("user_id", userId);
  await q;
}

// Recompute scores for every day with health data in the last `days` window.
// Used by the nightly /api/cron/health-scores job.
export async function recomputeRecentScores(
  supabase: SupabaseClient,
  days = 7,
  userId?: string,
): Promise<number> {
  const sinceKey = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  let q = supabase.from("health_daily").select("date").gte("date", sinceKey);
  if (userId) q = q.eq("user_id", userId);
  const { data } = await q;
  const dates = (data ?? []).map((r) => r.date as string);
  for (const d of dates) await recomputeScoresForDate(supabase, d, userId);
  return dates.length;
}

// Pull every user_id with at least one health_daily row in the window — the
// nightly cron iterates this list so multi-user installs all get scored.
export async function listUsersWithHealthData(
  supabase: SupabaseClient,
  days = 7,
): Promise<string[]> {
  const sinceKey = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  const { data } = await supabase
    .from("health_daily")
    .select("user_id")
    .gte("date", sinceKey);
  const ids = new Set<string>();
  for (const r of (data ?? []) as { user_id: string }[]) ids.add(r.user_id);
  return [...ids];
}
