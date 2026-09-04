import { z } from "zod";

// One source of truth for shape validation: used by API routes.
// (LLM-extracted records will reuse these same schemas in Phase 2 — P1.)

const isoDate = z.string().date(); // 'YYYY-MM-DD'

export const taskCreate = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  status: z.enum(["todo", "in_progress", "blocked", "done", "dropped"]).optional(),
  priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
  category: z.string().max(100).nullish(),
  due_date: isoDate.nullish(),
  estimated_minutes: z.number().int().positive().max(100000).nullish(),
  related_goal_id: z.string().uuid().nullish(),
  related_project_id: z.string().uuid().nullish(),
});
export const taskUpdate = taskCreate.partial();
export type TaskCreate = z.infer<typeof taskCreate>;
export type TaskUpdate = z.infer<typeof taskUpdate>;

export const goalCreate = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  category: z.string().max(100).nullish(),
  why_it_matters: z.string().max(2000).nullish(),
  deadline: isoDate.nullish(),
  status: z.enum(["active", "paused", "done", "dropped"]).optional(),
  progress_percentage: z.number().min(0).max(100).optional(),
  next_action: z.string().max(500).nullish(),
});
export const goalUpdate = goalCreate.partial();
export type GoalCreate = z.infer<typeof goalCreate>;

export const opportunityCreate = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  category: z.string().max(100).nullish(),
  estimated_value: z.number().nonnegative().max(1_000_000_000).nullish(),
  probability: z.number().min(0).max(1).nullish(),
  deadline: isoDate.nullish(),
  status: z
    .enum([
      "new",
      "researching",
      "contacted",
      "negotiating",
      "waiting",
      "won",
      "lost",
      "archived",
    ])
    .optional(),
  next_action: z.string().max(500).nullish(),
  related_contact_id: z.string().uuid().nullish(),
  related_company_id: z.string().uuid().nullish(),
  risk_level: z.enum(["low", "medium", "high"]).nullish(),
});
export const opportunityUpdate = opportunityCreate.partial();
export type OpportunityCreate = z.infer<typeof opportunityCreate>;

export const riskCreate = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  // DB column is NOT NULL — default keeps single-field quick-add working.
  category: z
    .enum([
      "health",
      "finance",
      "legal",
      "career",
      "business",
      "technical",
      "relationship",
      "time",
      "security",
      "data_loss",
    ])
    .default("business"),
  probability: z.number().int().min(1).max(5).nullish(),
  impact: z.number().int().min(1).max(5).nullish(),
  mitigation_plan: z.string().max(5000).nullish(),
  owner: z.string().max(200).nullish(),
  status: z
    .enum(["open", "mitigating", "monitoring", "closed", "accepted"])
    .optional(),
  review_date: isoDate.nullish(),
});
export const riskUpdate = riskCreate.partial();
export type RiskCreate = z.infer<typeof riskCreate>;

export const projectCreate = z.object({
  title: z.string().min(1).max(500),
  description: z.string().max(5000).nullish(),
  status: z.enum(["active", "paused", "done", "archived"]).optional(),
  category: z.string().max(100).nullish(),
  priority: z.enum(["low", "medium", "high", "critical"]).optional(),
  deadline: isoDate.nullish(),
  progress_percentage: z.number().min(0).max(100).optional(),
  related_goal_id: z.string().uuid().nullish(),
});
export const projectUpdate = projectCreate.partial();
export type ProjectCreate = z.infer<typeof projectCreate>;

// ---------- Phase 5: Health, fitness & nutrition ----------

// Permissive numeric helpers — HealthKit/Shortcuts can deliver any non-negative
// value; sanity caps stop a typo from poisoning baselines.
const posInt = z.number().int().nonnegative().max(1_000_000);
const posNum = z.number().nonnegative().max(1_000_000);
const isoDateTime = z.string().datetime();

export const healthDailyCreate = z.object({
  date: isoDate,
  steps: posInt.nullish(),
  sleep_minutes: posInt.max(24 * 60).nullish(),
  sleep_start: isoDateTime.nullish(),
  sleep_end: isoDateTime.nullish(),
  deep_sleep_minutes: posInt.max(24 * 60).nullish(),
  rem_sleep_minutes: posInt.max(24 * 60).nullish(),
  resting_heart_rate: posInt.max(250).nullish(),
  hrv: posNum.max(500).nullish(),
  vo2_max: posNum.max(120).nullish(),
  active_energy_burned: posNum.max(20_000).nullish(),
  workouts_count: posInt.max(50).nullish(),
  workout_minutes: posInt.max(24 * 60).nullish(),
  weight: posNum.max(1000).nullish(),
  body_fat_percentage: posNum.max(100).nullish(),
  calories_consumed: posInt.max(20_000).nullish(),
  protein_grams: posNum.max(2000).nullish(),
  source: z.enum(["healthkit", "shortcut", "manual"]).optional(),
  notes: z.string().max(5000).nullish(),
});
export type HealthDailyCreate = z.infer<typeof healthDailyCreate>;

export const workoutCreate = z.object({
  date: isoDate,
  workout_type: z.string().max(100).nullish(),
  duration_minutes: posInt.max(24 * 60).nullish(),
  calories_burned: posNum.max(20_000).nullish(),
  distance: posNum.max(1_000_000).nullish(), // meters
  average_heart_rate: posInt.max(250).nullish(),
  max_heart_rate: posInt.max(260).nullish(),
  source: z.enum(["healthkit", "shortcut", "manual"]).optional(),
  notes: z.string().max(2000).nullish(),
});
export type WorkoutCreate = z.infer<typeof workoutCreate>;

export const nutritionCreate = z.object({
  date: isoDate,
  meal_name: z.string().max(200).nullish(),
  calories: posInt.max(20_000).nullish(),
  protein: posNum.max(2000).nullish(),
  carbs: posNum.max(2000).nullish(),
  fat: posNum.max(2000).nullish(),
  ingredients: z.array(z.string().max(200)).max(50).optional(),
  source: z.enum(["healthkit", "shortcut", "manual"]).optional(),
  notes: z.string().max(2000).nullish(),
});
export type NutritionCreate = z.infer<typeof nutritionCreate>;

// HealthKit / Shortcuts payload — Option A and Option B both POST this same shape.
// Idempotent upsert on (user_id, date). Extra/unknown fields are ignored.
const healthkitIngestObject = z.object({
  date: isoDate,
  source: z.enum(["healthkit", "shortcut"]).default("healthkit"),
  steps: posInt.nullish(),
  sleep_minutes: posInt.max(24 * 60).nullish(),
  sleep_start: isoDateTime.nullish(),
  sleep_end: isoDateTime.nullish(),
  deep_sleep_minutes: posInt.max(24 * 60).nullish(),
  rem_sleep_minutes: posInt.max(24 * 60).nullish(),
  resting_heart_rate: posInt.max(250).nullish(),
  hrv: posNum.max(500).nullish(),
  vo2_max: posNum.max(120).nullish(),
  active_energy_burned: posNum.max(20_000).nullish(),
  weight: posNum.max(1000).nullish(),
  body_fat_percentage: posNum.max(100).nullish(),
  calories_consumed: posInt.max(20_000).nullish(),
  protein_grams: posNum.max(2000).nullish(),
  workouts: z
    .array(
      z.object({
        workout_type: z.string().max(100).optional(),
        duration_minutes: posInt.max(24 * 60).optional(),
        calories_burned: posNum.max(20_000).optional(),
        distance: posNum.max(1_000_000).optional(),
        average_heart_rate: posInt.max(250).optional(),
        max_heart_rate: posInt.max(260).optional(),
      }),
    )
    .max(50)
    .optional(),
});

// Apple Shortcuts / phone payloads: a metric with no reading today often
// arrives as "" (or null), and numbers are sometimes stringified. Strip
// empty/null values BEFORE validation so a missing metric is simply omitted
// (preserved on the (user_id,date) upsert, never a 400), and coerce clean
// numeric strings to numbers. Isolated to this ingest schema only.
export const healthkitIngest = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (k === "workouts") {
      out[k] = v;
      continue;
    }
    if (v === null || v === undefined) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") continue;
      out[k] = /^-?\d+(?:\.\d+)?$/.test(t) ? Number(t) : v;
      continue;
    }
    out[k] = v;
  }
  return out;
}, healthkitIngestObject);
export type HealthkitIngest = z.infer<typeof healthkitIngestObject>;

export const targetsUpdate = z.object({
  steps: posInt.max(100_000).optional(),
  sleepMinutes: posInt.max(24 * 60).optional(),
  activeEnergy: posInt.max(20_000).optional(),
  workoutMinutes: posInt.max(24 * 60).optional(),
  protein: posInt.max(2000).optional(),
  calories: posInt.max(20_000).optional(),
  rhrBaseline: posInt.max(250).optional(),
  hrvBaseline: posInt.max(500).optional(),
});
export type TargetsUpdate = z.infer<typeof targetsUpdate>;

// ---- Phase 6: graph ---------------------------------------------------------

export const entityCreate = z.object({
  name: z.string().min(1).max(120),
  entity_type: z.enum([
    "person", "company", "project", "organization",
    "tool", "location", "event", "asset",
  ]),
  description: z.string().max(2000).nullish(),
  metadata: z.record(z.unknown()).optional(),
});
export type EntityCreate = z.infer<typeof entityCreate>;

export const relationshipCreate = z.object({
  source_entity_id: z.string().uuid(),
  target_entity_id: z.string().uuid(),
  relationship_type: z.string().min(1).max(60),
  strength: z.number().min(0).max(1).nullish(),
  notes: z.string().max(2000).nullish(),
}).refine((r) => r.source_entity_id !== r.target_entity_id, {
  message: "source and target must differ",
});
export type RelationshipCreate = z.infer<typeof relationshipCreate>;

export const relationshipUpdate = z.object({
  relationship_type: z.string().min(1).max(60).optional(),
  strength: z.number().min(0).max(1).nullish(),
  notes: z.string().max(2000).nullish(),
});
export type RelationshipUpdate = z.infer<typeof relationshipUpdate>;

// ---- Spec §10 remaining domain CRUD ----------------------------------------

export const decisionCreate = z.object({
  title: z.string().min(1).max(300),
  decision: z.string().max(5000).nullish(),
  context: z.string().max(5000).nullish(),
  expected_outcome: z.string().max(2000).nullish(),
  actual_outcome: z.string().max(2000).nullish(),
  review_date: z.string().date().nullish(),
  status: z.enum(["open", "reviewing", "reviewed", "reversed"]).optional(),
  lesson_learned: z.string().max(2000).nullish(),
  assumption_confidence: z.number().min(0).max(1).nullish(),
  outcome_score: z.number().min(0).max(1).nullish(),  // DB check: numeric(4,3) between 0 and 1
});
export const decisionUpdate = decisionCreate.partial();
export type DecisionCreate = z.infer<typeof decisionCreate>;

export const contactCreate = z.object({
  name: z.string().min(1).max(200),
  type: z.string().max(50).nullish(),
  role: z.string().max(120).nullish(),
  company: z.string().max(200).nullish(),
  email: z.string().email().max(320).nullish().or(z.literal("").transform(() => null)),
  phone: z.string().max(40).nullish(),
  relationship_strength: z.coerce.number().int().min(1).max(5).nullish(),
  last_contacted_at: z.string().datetime({ offset: true }).nullish(),
  next_follow_up_at: z.string().datetime({ offset: true }).nullish(),
  notes: z.string().max(5000).nullish(),
});
export const contactUpdate = contactCreate.partial();
export type ContactCreate = z.infer<typeof contactCreate>;

export const journalCreate = z.object({
  raw_text: z.string().min(1).max(20000),
  mood: z.coerce.number().int().min(1).max(5).nullish(),
  energy_level: z.coerce.number().int().min(1).max(5).nullish(),
  stress_level: z.coerce.number().int().min(1).max(5).nullish(),
  sleep_quality: z.coerce.number().int().min(1).max(5).nullish(),
  entry_date: z.string().date().optional(),
});
export type JournalCreate = z.infer<typeof journalCreate>;

const money = z.coerce.number().finite().nullish();
export const financeSnapshotCreate = z.object({
  date: z.string().date(),
  assets: money,
  liabilities: money,
  net_worth: money,
  income_month_to_date: money,
  expenses_month_to_date: money,
  investment_value: money,
  cash_balance: money,
  currency: z.string().length(3).toUpperCase().optional(),
  source: z.enum(["manual", "gsheet", "import"]).optional(),
  notes: z.string().max(2000).nullish(),
});
export const financeSnapshotUpdate = financeSnapshotCreate.partial();
export type FinanceSnapshotCreate = z.infer<typeof financeSnapshotCreate>;

export const learningCreate = z.object({
  title: z.string().min(1).max(300),
  type: z.string().max(50).nullish(),
  subject: z.string().max(120).nullish(),
  current_level: z.string().max(60).nullish(),
  target_level: z.string().max(60).nullish(),
  status: z.enum(["queued", "active", "paused", "done", "dropped"]).optional(),
  progress_percentage: z.coerce.number().min(0).max(100).optional(),
  next_action: z.string().max(500).nullish(),
  related_goal_id: z.string().uuid().nullish(),
});
export const learningUpdate = learningCreate.partial();
export type LearningCreate = z.infer<typeof learningCreate>;

export const timeLogCreate = z.object({
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }).nullish(),
  category: z.string().max(60).nullish(),
  notes: z.string().max(2000).nullish(),
  task_id: z.string().uuid().nullish(),
  project_id: z.string().uuid().nullish(),
});
export const timeLogUpdate = timeLogCreate.partial();
export type TimeLogCreate = z.infer<typeof timeLogCreate>;

export const calendarEventCreate = z.object({
  title: z.string().min(1).max(300),
  start_time: z.string().datetime({ offset: true }),
  end_time: z.string().datetime({ offset: true }).nullish(),
  location: z.string().max(300).nullish(),
  description: z.string().max(2000).nullish(),
});
export type CalendarEventCreate = z.infer<typeof calendarEventCreate>;

// ---- §10 intelligence & memory ----------------------------------------------

export const memorySearch = z.object({
  query: z.string().min(1).max(2000),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});
export type MemorySearch = z.infer<typeof memorySearch>;

export const askQuery = z.object({
  question: z.string().min(1).max(2000),
});
export type AskQuery = z.infer<typeof askQuery>;
