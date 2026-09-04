import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_TARGETS,
  emptySnapshot,
  type CoFreshness,
  type CoHealthDay,
  type CoTomorrow,
  type Snapshot,
} from "@/lib/chief/types";
import { DAY_MS } from "@/lib/scoring/util";

// Default daily focus capacity used by the overcommitted_day rule.
const DEFAULT_CAPACITY_MIN = 8 * 60;

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Read the user's data (RLS-scoped) into a Snapshot for the rules engine.
export async function buildSnapshot(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<Snapshot> {
  const tomorrow = new Date(now.getTime() + DAY_MS);
  const tomorrowStart = new Date(tomorrow);
  tomorrowStart.setUTCHours(0, 0, 0, 0);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + DAY_MS);
  const tomorrowDay = isoDay(tomorrowStart);
  const since14d = isoDay(new Date(now.getTime() - 14 * DAY_MS));

  const [
    tasks,
    goals,
    projects,
    opportunities,
    risks,
    contacts,
    decisions,
    review,
    health,
    tomorrowEvents,
    tomorrowTasks,
    finance,
    journal,
    workouts,
  ] = await Promise.all([
    supabase
      .from("tasks")
      .select("id,title,status,due_date,postpone_count,updated_at")
      .neq("status", "done")
      .limit(500),
    supabase
      .from("goals")
      .select("id,title,status,progress_percentage,deadline,updated_at")
      .limit(500),
    supabase
      .from("projects")
      .select("id,title,status,progress_percentage,updated_at")
      .limit(500),
    supabase
      .from("opportunities")
      .select("id,title,status,expected_value,next_action")
      .limit(500),
    supabase
      .from("risks")
      .select("id,title,status,risk_score,mitigation_plan")
      .limit(500),
    supabase
      .from("contacts")
      .select("id,name,relationship_strength,last_contacted_at,next_follow_up_at")
      .limit(1000),
    supabase.from("decisions").select("id,title,status,review_date").limit(500),
    supabase
      .from("review_queue")
      .select("id", { count: "exact", head: true })
      .eq("status", "open"),
    supabase
      .from("health_daily")
      .select("date,sleep_minutes,steps,resting_heart_rate")
      .gte("date", since14d)
      .order("date", { ascending: true })
      .limit(14),
    supabase
      .from("calendar_events_cache")
      .select("start_time,end_time")
      .gte("start_time", tomorrowStart.toISOString())
      .lt("start_time", tomorrowEnd.toISOString())
      .limit(200),
    supabase
      .from("tasks")
      .select("estimated_minutes")
      .eq("due_date", tomorrowDay)
      .neq("status", "done")
      .limit(500),
    supabase
      .from("finance_snapshots")
      .select("date")
      .order("date", { ascending: false })
      .limit(1),
    supabase
      .from("journal_entries")
      .select("entry_date")
      .order("entry_date", { ascending: false })
      .limit(1),
    supabase
      .from("workouts")
      .select("date")
      .order("date", { ascending: false })
      .limit(1),
  ]);

  const healthRows = (health.data ?? []) as CoHealthDay[];

  // Tomorrow load.
  let calendarBusyMinutes = 0;
  for (const ev of tomorrowEvents.data ?? []) {
    const s = new Date(ev.start_time);
    const e = ev.end_time ? new Date(ev.end_time) : null;
    if (e && !Number.isNaN(s.getTime()) && !Number.isNaN(e.getTime())) {
      calendarBusyMinutes += Math.max(0, (e.getTime() - s.getTime()) / 60000);
    } else if (!Number.isNaN(s.getTime())) {
      // Default to 30m for events without an end time.
      calendarBusyMinutes += 30;
    }
  }
  const dueTaskEstimatedMinutes = (tomorrowTasks.data ?? []).reduce(
    (sum, t) => sum + (t.estimated_minutes ?? 30),
    0,
  );
  const tomorrowSnap: CoTomorrow = {
    date: tomorrowDay,
    calendarBusyMinutes: Math.round(calendarBusyMinutes),
    dueTaskEstimatedMinutes,
    capacityMinutes: DEFAULT_CAPACITY_MIN,
  };

  // Freshness — days since the most recent row in each table.
  const daysSince = (iso: string | null | undefined): number | null => {
    if (!iso) return null;
    const t = new Date(iso.length === 10 ? iso + "T00:00:00Z" : iso).getTime();
    if (Number.isNaN(t)) return null;
    return Math.max(0, (now.getTime() - t) / DAY_MS);
  };
  const lastHealth = healthRows.length
    ? (healthRows[healthRows.length - 1]?.date ?? null)
    : null;
  const freshness: CoFreshness = {
    health_daily: daysSince(lastHealth),
    finance_snapshots: daysSince(finance.data?.[0]?.date ?? null),
    journal_entries: daysSince(journal.data?.[0]?.entry_date ?? null),
    workouts: daysSince(workouts.data?.[0]?.date ?? null),
  };

  return {
    ...emptySnapshot(now),
    tasks: tasks.data ?? [],
    goals: goals.data ?? [],
    projects: projects.data ?? [],
    opportunities: opportunities.data ?? [],
    risks: risks.data ?? [],
    contacts: contacts.data ?? [],
    decisions: decisions.data ?? [],
    reviewQueueOpenCount: review.count ?? 0,
    health: healthRows,
    tomorrow: tomorrowSnap,
    freshness,
    targets: DEFAULT_TARGETS,
  };
}
