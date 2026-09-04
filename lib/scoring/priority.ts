import { clamp, clamp01, daysUntil, daysSince } from "@/lib/scoring/util";

export type TaskPriority = "low" | "medium" | "high" | "urgent";

export type PriorityInput = {
  priority: TaskPriority;
  dueDate?: string | null;
  postponeCount?: number | null;
  createdAt?: string | null;
  linkedGoalImportance?: number | null; // 0..1
  now?: Date;
};

const RANK: Record<TaskPriority, number> = { low: 0, medium: 0.34, high: 0.67, urgent: 1 };

// Deterministic 0..100 task priority. Default weights [urgency,rank,goal,postpone] − ageDecay.
// Due within 24h or priority=urgent floors the score at 80.
export function computeTaskPriority(input: PriorityInput): number {
  const now = input.now ?? new Date();
  const dueDays = daysUntil(input.dueDate ?? null, now);

  let urgency = 0;
  if (dueDays !== null) {
    if (dueDays <= 1) urgency = 1; // due, overdue, or within a day
    else if (dueDays >= 14) urgency = 0;
    else urgency = 1 - (dueDays - 1) / 13;
  }

  const rank = RANK[input.priority] ?? 0.34;
  const goal = clamp01(input.linkedGoalImportance ?? 0);
  const postpone = clamp01((input.postponeCount ?? 0) / 5);
  const ageDays = daysSince(input.createdAt ?? null, now) ?? 0;
  const ageDecay = clamp01(ageDays / 60);

  const raw = 40 * urgency + 25 * rank + 20 * goal + 10 * postpone - 5 * ageDecay;
  let score = clamp(raw, 0, 100);

  if (input.priority === "urgent" || (dueDays !== null && dueDays <= 1)) {
    score = Math.max(score, 80);
  }
  return Math.round(score);
}
