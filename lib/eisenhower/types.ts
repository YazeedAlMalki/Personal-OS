// Eisenhower Matrix — shared types.

export const QUADRANTS = ["do_now", "schedule", "delegate", "drop"] as const;
export type Quadrant = (typeof QUADRANTS)[number];

export type ScoredResult = {
  urgency: number;       // 0–100
  importance: number;    // 0–100
  quadrant: Quadrant;
  confidence: number;    // 0.00–1.00
  reason: string;        // human-readable explanation
};

/** Minimal task shape the scoring engine needs. */
export type ScoringTask = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: string | null;
  postpone_count?: number | null;
  related_goal_id?: string | null;
  related_project_id?: string | null;
  related_opportunity_id?: string | null;
};

/** Pre-loaded context about the user's active goals/projects/opps. */
export type ScoringContext = {
  now: Date;
  activeGoalIds: Set<string>;
  activeProjectIds: Set<string>;
  highValueOppIds: Set<string>;
  /** goal_id → { title, deadline } */
  goalMeta: Map<string, { title: string; deadline?: string | null }>;
};
