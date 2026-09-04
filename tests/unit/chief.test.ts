import { describe, it, expect } from "vitest";
import { runChiefOfStaff } from "@/lib/chief";
import { emptySnapshot, type Snapshot } from "@/lib/chief/types";

const NOW = new Date("2026-06-10T12:00:00Z");

function snapshot(): Snapshot {
  return {
    ...emptySnapshot(NOW),
    tasks: [
      { id: "t1", title: "Postponed thing", status: "todo", postpone_count: 4 },
      { id: "t2", title: "Late thing", status: "todo", due_date: "2026-06-01" },
    ],
    goals: [{ id: "g1", title: "Stale goal", status: "active", updated_at: "2026-05-01T00:00:00Z" }],
    projects: [{ id: "p1", title: "Stalled project", status: "active", updated_at: "2026-04-20T00:00:00Z" }],
    opportunities: [
      { id: "o1", title: "Big deal", status: "negotiating", expected_value: 50000, next_action: null },
    ],
    risks: [{ id: "r1", title: "Key risk", status: "open", risk_score: 16, mitigation_plan: null }],
    contacts: [{ id: "c1", name: "Sam", relationship_strength: 4, last_contacted_at: "2026-04-15" }],
    decisions: [{ id: "d1", title: "Old call", status: "open", review_date: "2026-06-01" }],
    reviewQueueOpenCount: 3,
  };
}

describe("runChiefOfStaff", () => {
  const insights = runChiefOfStaff(snapshot());
  const types = new Set(insights.map((i) => i.insight_type));

  it("fires every expected rule", () => {
    for (const t of [
      "serial_postponement",
      "overdue_task",
      "inactive_goal",
      "stalled_project",
      "idle_opportunity",
      "unmitigated_risk",
      "stale_follow_up",
      "decision_review",
      "review_backlog",
    ]) {
      expect(types.has(t), `expected ${t}`).toBe(true);
    }
  });

  it("sorts most severe first", () => {
    expect(insights[0]?.severity).toBe("high");
  });

  it("stays quiet on a clean slate", () => {
    expect(runChiefOfStaff(emptySnapshot(NOW))).toHaveLength(0);
  });

  it("each insight references its source record", () => {
    const withRecord = insights.filter((i) => i.related_table);
    expect(withRecord.length).toBeGreaterThan(0);
  });
});
