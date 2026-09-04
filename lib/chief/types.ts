// Chief of Staff — shared types. The rules engine reads a Snapshot of the user's
// data and emits Insights. Pure + deterministic (no LLM): the decision to raise an
// alert is always rules-based; a model is only used later to phrase it nicely.

export type Severity = "info" | "low" | "medium" | "high" | "critical";

export type Insight = {
  insight_type: string;
  title: string;
  body?: string;
  severity: Severity;
  related_table?: string;
  related_record_id?: string;
  confidence_score?: number;
};

export type CoTask = {
  id: string;
  title: string;
  status: string;
  due_date?: string | null;
  postpone_count?: number | null;
  updated_at?: string | null;
};
export type CoGoal = {
  id: string;
  title: string;
  status: string;
  progress_percentage?: number | null;
  deadline?: string | null;
  updated_at?: string | null;
};
export type CoProject = {
  id: string;
  title: string;
  status: string;
  progress_percentage?: number | null;
  updated_at?: string | null;
};
export type CoOpportunity = {
  id: string;
  title: string;
  status: string;
  expected_value?: number | null;
  next_action?: string | null;
};
export type CoRisk = {
  id: string;
  title: string;
  status: string;
  risk_score?: number | null;
  mitigation_plan?: string | null;
};
export type CoContact = {
  id: string;
  name: string;
  relationship_strength?: number | null;
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
};
export type CoDecision = {
  id: string;
  title: string;
  status: string;
  review_date?: string | null;
};

// Recent health rows (last ~14d) used by sleep_decline + low_activity rules.
export type CoHealthDay = {
  date: string; // YYYY-MM-DD
  sleep_minutes?: number | null;
  steps?: number | null;
  resting_heart_rate?: number | null;
};

// For overcommitted_day: tomorrow's calendar load + due-task workload.
export type CoTomorrow = {
  date: string; // YYYY-MM-DD of tomorrow
  calendarBusyMinutes: number;
  dueTaskEstimatedMinutes: number;
  capacityMinutes: number;
};

// data_drift: when key tables haven't seen a row recently.
// Values are days since the most recent row (null = never).
export type CoFreshness = {
  health_daily?: number | null;
  finance_snapshots?: number | null;
  journal_entries?: number | null;
  workouts?: number | null;
};

// Defaults for new health-related rule thresholds.
// Conservative; can be tuned in lib/chief/config.ts later.
export type CoTargets = {
  sleepMinutes: number; // target nightly sleep
  steps: number; // target daily steps
};

export type Snapshot = {
  now: Date;
  tasks: CoTask[];
  goals: CoGoal[];
  projects: CoProject[];
  opportunities: CoOpportunity[];
  risks: CoRisk[];
  contacts: CoContact[];
  decisions: CoDecision[];
  reviewQueueOpenCount?: number;
  health?: CoHealthDay[];
  tomorrow?: CoTomorrow;
  freshness?: CoFreshness;
  targets?: CoTargets;
};

export type Rule = { id: string; run: (s: Snapshot) => Insight[] };

export const DEFAULT_TARGETS: CoTargets = {
  sleepMinutes: 7 * 60, // 7h
  steps: 8000,
};

export function emptySnapshot(now: Date = new Date()): Snapshot {
  return {
    now,
    tasks: [],
    goals: [],
    projects: [],
    opportunities: [],
    risks: [],
    contacts: [],
    decisions: [],
    reviewQueueOpenCount: 0,
    health: [],
    targets: DEFAULT_TARGETS,
  };
}
