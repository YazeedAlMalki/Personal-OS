import { clamp, daysSince, daysUntil } from "@/lib/scoring/util";
import type { Insight, Rule, Snapshot } from "@/lib/chief/types";

export * from "@/lib/chief/types";

const ACTIVE_OPP = new Set(["new", "researching", "contacted", "negotiating", "waiting"]);

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = clamp(Math.floor(p * (sortedAsc.length - 1)), 0, sortedAsc.length - 1);
  return sortedAsc[idx] ?? 0;
}

// ---- Rules (architecture §9.1) -------------------------------------------

const staleFollowUp: Rule = {
  id: "stale_follow_up",
  run: (s) =>
    s.contacts
      .filter((c) => {
        const overdueFollow = c.next_follow_up_at != null && (daysUntil(c.next_follow_up_at, s.now) ?? 1) < 0;
        const drifted =
          (c.relationship_strength ?? 0) >= 3 && (daysSince(c.last_contacted_at, s.now) ?? 999) > 21;
        return overdueFollow || drifted;
      })
      .map((c) => ({
        insight_type: "stale_follow_up",
        title: `Follow up with ${c.name}`,
        body: `No recent contact${c.last_contacted_at ? "" : " on record"}. Reconnect to keep the relationship warm.`,
        severity: "medium" as const,
        related_table: "contacts",
        related_record_id: c.id,
        confidence_score: 0.8,
      })),
};

const idleHighValueOpportunity: Rule = {
  id: "idle_opportunity",
  run: (s) => {
    const active = s.opportunities.filter((o) => ACTIVE_OPP.has(o.status));
    const values = active
      .map((o) => o.expected_value ?? 0)
      .filter((v) => v > 0)
      .sort((a, b) => a - b);
    const q3 = percentile(values, 0.75);
    return active
      .filter((o) => q3 > 0 && (o.expected_value ?? 0) >= q3 && !o.next_action)
      .map((o) => ({
        insight_type: "idle_opportunity",
        title: `High-value opportunity stalled: ${o.title}`,
        body: `Expected value ~${Math.round(o.expected_value ?? 0)} but no next action set.`,
        severity: "high" as const,
        related_table: "opportunities",
        related_record_id: o.id,
        confidence_score: 0.85,
      }));
  },
};

const serialPostponement: Rule = {
  id: "serial_postponement",
  run: (s) =>
    s.tasks
      .filter((t) => t.status !== "done" && (t.postpone_count ?? 0) >= 3)
      .map((t) => ({
        insight_type: "serial_postponement",
        title: `Postponed ${t.postpone_count}×: ${t.title}`,
        body: "Repeatedly deferred. Do it, delegate it, or drop it.",
        severity: "medium" as const,
        related_table: "tasks",
        related_record_id: t.id,
        confidence_score: 0.9,
      })),
};

const overdueTask: Rule = {
  id: "overdue_task",
  run: (s) =>
    s.tasks
      .filter((t) => t.status !== "done" && t.due_date != null && (daysUntil(t.due_date, s.now) ?? 1) < 0)
      .map((t) => ({
        insight_type: "overdue_task",
        title: `Overdue: ${t.title}`,
        body: `Was due ${t.due_date}.`,
        severity: "high" as const,
        related_table: "tasks",
        related_record_id: t.id,
        confidence_score: 0.95,
      })),
};

const inactiveGoal: Rule = {
  id: "inactive_goal",
  run: (s) =>
    s.goals
      .filter((g) => g.status === "active" && (daysSince(g.updated_at, s.now) ?? 0) > 14)
      .map((g) => ({
        insight_type: "inactive_goal",
        title: `Goal going stale: ${g.title}`,
        body: "No progress in over two weeks. Link a task or revise it.",
        severity: "medium" as const,
        related_table: "goals",
        related_record_id: g.id,
        confidence_score: 0.7,
      })),
};

const stalledProject: Rule = {
  id: "stalled_project",
  run: (s) =>
    s.projects
      .filter((p) => p.status === "active" && (daysSince(p.updated_at, s.now) ?? 0) > 21)
      .map((p) => ({
        insight_type: "stalled_project",
        title: `Project stalled: ${p.title}`,
        body: "No movement in 3+ weeks.",
        severity: "medium" as const,
        related_table: "projects",
        related_record_id: p.id,
        confidence_score: 0.7,
      })),
};

const decisionReviewDue: Rule = {
  id: "decision_review",
  run: (s) =>
    s.decisions
      .filter((d) => d.status !== "reviewed" && d.review_date != null && (daysUntil(d.review_date, s.now) ?? 1) <= 0)
      .map((d) => ({
        insight_type: "decision_review",
        title: `Review decision: ${d.title}`,
        body: "Review date reached — were the assumptions right? What's the lesson?",
        severity: "medium" as const,
        related_table: "decisions",
        related_record_id: d.id,
        confidence_score: 0.9,
      })),
};

const unmitigatedRisk: Rule = {
  id: "unmitigated_risk",
  run: (s) =>
    s.risks
      .filter((r) => r.status !== "closed" && (r.risk_score ?? 0) >= 12 && !r.mitigation_plan)
      .map((r) => ({
        insight_type: "unmitigated_risk",
        title: `High risk with no mitigation: ${r.title}`,
        body: `Risk score ${r.risk_score}. Add a mitigation plan.`,
        severity: "high" as const,
        related_table: "risks",
        related_record_id: r.id,
        confidence_score: 0.9,
      })),
};

const reviewBacklog: Rule = {
  id: "review_backlog",
  run: (s) =>
    (s.reviewQueueOpenCount ?? 0) > 0
      ? [
          {
            insight_type: "review_backlog",
            title: `${s.reviewQueueOpenCount} item(s) awaiting review`,
            body: "Low-confidence captures are waiting for you to confirm or correct.",
            severity: "low" as const,
            related_table: "review_queue",
            confidence_score: 1,
          },
        ]
      : [],
};

// Sleep decline — 3 consecutive nights below target.
const sleepDecline: Rule = {
  id: "sleep_decline",
  run: (s) => {
    const target = s.targets?.sleepMinutes ?? 7 * 60;
    const days = (s.health ?? [])
      .filter((h) => typeof h.sleep_minutes === "number")
      .slice(-3);
    if (days.length < 3) return [];
    const allLow = days.every((d) => (d.sleep_minutes ?? 0) < target);
    if (!allLow) return [];
    const avgMin = Math.round(
      days.reduce((sum, d) => sum + (d.sleep_minutes ?? 0), 0) / days.length,
    );
    const targetHrs = (target / 60).toFixed(1);
    const avgHrs = (avgMin / 60).toFixed(1);
    return [
      {
        insight_type: "sleep_decline",
        title: "Sleep below target 3 nights running",
        body: `Last 3 nights averaged ${avgHrs}h, target ${targetHrs}h. Recovery slips fast — protect tonight.`,
        severity: "medium" as const,
        related_table: "health_daily",
        confidence_score: 0.8,
      },
    ];
  },
};

// Low activity — 7-day average steps below 80% of target.
const lowActivity: Rule = {
  id: "low_activity",
  run: (s) => {
    const target = s.targets?.steps ?? 8000;
    const days = (s.health ?? [])
      .filter((h) => typeof h.steps === "number")
      .slice(-7);
    if (days.length < 5) return [];
    const avg = days.reduce((sum, d) => sum + (d.steps ?? 0), 0) / days.length;
    if (avg >= target * 0.8) return [];
    return [
      {
        insight_type: "low_activity",
        title: "Steps trending low",
        body: `7-day average ${Math.round(avg).toLocaleString()} steps (target ${target.toLocaleString()}). A 20-min walk closes most of the gap.`,
        severity: "low" as const,
        related_table: "health_daily",
        confidence_score: 0.75,
      },
    ];
  },
};

// Overcommitted day — tomorrow's busy + due-task estimates exceed capacity.
const overcommittedDay: Rule = {
  id: "overcommitted_day",
  run: (s) => {
    const t = s.tomorrow;
    if (!t) return [];
    const load = t.calendarBusyMinutes + t.dueTaskEstimatedMinutes;
    if (load <= t.capacityMinutes) return [];
    const loadHrs = (load / 60).toFixed(1);
    const capHrs = (t.capacityMinutes / 60).toFixed(1);
    const overHrs = ((load - t.capacityMinutes) / 60).toFixed(1);
    return [
      {
        insight_type: "overcommitted_day",
        title: "Tomorrow looks overloaded",
        body: `${loadHrs}h of meetings + due-task work against ~${capHrs}h capacity (~${overHrs}h over). Move or drop something now.`,
        severity: "high" as const,
        related_table: "calendar_events_cache",
        confidence_score: 0.7,
      },
    ];
  },
};

// Data drift — key tables haven't been written to recently.
const dataDrift: Rule = {
  id: "data_drift",
  run: (s) => {
    const f = s.freshness;
    if (!f) return [];
    const checks: { key: keyof typeof f; label: string; threshold: number }[] = [
      { key: "health_daily", label: "health", threshold: 3 },
      { key: "finance_snapshots", label: "finance", threshold: 30 },
      { key: "journal_entries", label: "journal", threshold: 14 },
      { key: "workouts", label: "workouts", threshold: 14 },
    ];
    const stale = checks.filter((c) => {
      const days = f[c.key];
      return days == null || days >= c.threshold;
    });
    if (stale.length === 0) return [];
    return [
      {
        insight_type: "data_drift",
        title: `Data going stale: ${stale.map((x) => x.label).join(", ")}`,
        body: "Insights and forecasts assume current data. Sync or log the missing streams.",
        severity: "info" as const,
        related_table: "system",
        confidence_score: 0.95,
      },
    ];
  },
};

export const RULES: Rule[] = [
  staleFollowUp,
  idleHighValueOpportunity,
  serialPostponement,
  overdueTask,
  inactiveGoal,
  stalledProject,
  decisionReviewDue,
  unmitigatedRisk,
  reviewBacklog,
  sleepDecline,
  lowActivity,
  overcommittedDay,
  dataDrift,
];

const SEVERITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

// Run every rule, most severe first.
export function runChiefOfStaff(s: Snapshot): Insight[] {
  const out: Insight[] = [];
  for (const rule of RULES) {
    try {
      out.push(...rule.run(s));
    } catch {
      // a single rule failing must not break the whole briefing
    }
  }
  return out.sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}
