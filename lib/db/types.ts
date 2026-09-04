// Minimal hand-written row types for Phase 1 domains.
// Later: replace/augment with `supabase gen types typescript`.

export type TaskStatus = "todo" | "in_progress" | "blocked" | "done" | "dropped";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type Task = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  priority_score: number;
  category: string | null;
  due_date: string | null;
  estimated_minutes: number | null;
  actual_minutes: number | null;
  postpone_count: number;
  source: string | null;
  related_goal_id: string | null;
  related_project_id: string | null;
  related_contact_id: string | null;
  related_opportunity_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export type Goal = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  why_it_matters: string | null;
  deadline: string | null;
  status: "active" | "paused" | "done" | "dropped";
  progress_percentage: number;
  target_metric: number | null;
  current_metric: number | null;
  next_action: string | null;
  created_at: string;
  updated_at: string;
};

export type Opportunity = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category: string | null;
  estimated_value: number | null;
  probability: number | null;
  expected_value: number; // generated column
  deadline: string | null;
  status:
    | "new"
    | "researching"
    | "contacted"
    | "negotiating"
    | "waiting"
    | "won"
    | "lost"
    | "archived";
  next_action: string | null;
  related_contact_id: string | null;
  related_company_id: string | null;
  risk_level: "low" | "medium" | "high" | null;
  created_at: string;
  updated_at: string;
};

export type Risk = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  category:
    | "health"
    | "finance"
    | "legal"
    | "career"
    | "business"
    | "technical"
    | "relationship"
    | "time"
    | "security"
    | "data_loss";
  probability: number | null; // 1–5
  impact: number | null; // 1–5
  risk_score: number; // generated column: probability * impact
  mitigation_plan: string | null;
  owner: string | null;
  status: "open" | "mitigating" | "monitoring" | "closed" | "accepted";
  review_date: string | null;
  created_at: string;
  updated_at: string;
};

export type Project = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  status: "active" | "paused" | "done" | "archived";
  category: string | null;
  priority: "low" | "medium" | "high" | "critical";
  deadline: string | null;
  progress_percentage: number;
  related_goal_id: string | null;
  created_at: string;
  updated_at: string;
};

// ---- Spec §5.4 decisions / §5.5 contacts / §5.7 finance+learning / §5.8 journal+calendar ----

export type DecisionStatus = "open" | "reviewing" | "reviewed" | "reversed";

export type Decision = {
  id: string;
  user_id: string;
  title: string;
  decision: string | null;
  context: string | null;
  options_considered: unknown[];
  assumptions: unknown[];
  expected_outcome: string | null;
  actual_outcome: string | null;
  review_date: string | null;
  status: DecisionStatus;
  lesson_learned: string | null;
  assumption_confidence: number | null;
  outcome_score: number | null;
  outcome_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Contact = {
  id: string;
  user_id: string;
  name: string;
  type: string | null;
  role: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  relationship_strength: number | null;
  last_contacted_at: string | null;
  next_follow_up_at: string | null;
  notes: string | null;
  entity_id: string | null;
  created_at: string;
  updated_at: string;
};

export type JournalEntry = {
  id: string;
  user_id: string;
  raw_text: string;
  summary: string | null;
  mood: number | null;
  energy_level: number | null;
  stress_level: number | null;
  sleep_quality: number | null;
  themes: unknown[];
  lessons: unknown[];
  action_items: unknown[];
  entry_date: string;
  created_at: string;
};

export type FinanceSnapshot = {
  id: string;
  user_id: string;
  date: string;
  assets: number | null;
  liabilities: number | null;
  net_worth: number | null;
  income_month_to_date: number | null;
  expenses_month_to_date: number | null;
  investment_value: number | null;
  cash_balance: number | null;
  currency: string;
  source: string;
  notes: string | null;
  created_at: string;
};

export type LearningStatus = "queued" | "active" | "paused" | "done" | "dropped";

export type LearningItem = {
  id: string;
  user_id: string;
  title: string;
  type: string | null;
  subject: string | null;
  current_level: string | null;
  target_level: string | null;
  status: LearningStatus;
  progress_percentage: number;
  next_action: string | null;
  related_goal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TimeLog = {
  id: string;
  user_id: string;
  task_id: string | null;
  project_id: string | null;
  category: string | null;
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
  notes: string | null;
  created_at: string;
};

export type CalendarEvent = {
  id: string;
  user_id: string;
  external_calendar_id: string | null;
  external_event_id: string | null;
  title: string | null;
  start_time: string;
  end_time: string | null;
  location: string | null;
  description: string | null;
  source: string;
  created_at: string;
  updated_at: string;
};
