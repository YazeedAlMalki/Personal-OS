import { describe, it, expect } from "vitest";

// Inline the pure scoring logic to avoid server-only import issues.
// Mirrors lib/eisenhower/score.ts exactly.

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

const DAY_MS = 86_400_000;

function daysUntil(date: string | Date | null | undefined, now: Date): number | null {
  if (date == null) return null;
  const d = date instanceof Date ? date : new Date(String(date).length === 10 ? date + "T00:00:00" : date);
  if (Number.isNaN(d.getTime())) return null;
  const a = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const b = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((a - b) / DAY_MS);
}

type ScoringTask = {
  title: string;
  description?: string | null;
  due_date?: string | null;
  priority?: string | null;
  postpone_count?: number | null;
  related_goal_id?: string | null;
  related_project_id?: string | null;
  related_opportunity_id?: string | null;
};

type ScoringContext = {
  now: Date;
  activeGoalIds: Set<string>;
  activeProjectIds: Set<string>;
  highValueOppIds: Set<string>;
  goalMeta: Map<string, { title: string; deadline?: string | null }>;
};

type ScoreBreakdown = { score: number; reasons: string[] };

const URGENT_WORDS = /\b(asap|urgent|immediately|right now|critical|emergency)\b/i;
const NOT_URGENT_WORDS = /\b(no rush|someday|eventually|when possible|low priority|no hurry|whenever)\b/i;
const TODAY_WORDS = /\b(today|tonight|this evening|this morning)\b/i;

function scoreUrgency(task: ScoringTask, now: Date): ScoreBreakdown {
  let score = 30;
  const reasons: string[] = [];

  if (task.due_date) {
    const d = daysUntil(task.due_date, now);
    if (d !== null) {
      if (d < 0) { score = 95; reasons.push(`Overdue by ${Math.abs(Math.round(d))}d`); }
      else if (d < 1) { score = 90; reasons.push("Due today"); }
      else if (d < 3) { score = 75; reasons.push(`Due in ${Math.round(d)}d`); }
      else if (d < 7) { score = 60; reasons.push("Due this week"); }
      else if (d < 30) { score = 40; reasons.push(`Due in ${Math.round(d)}d`); }
      else { score = 25; reasons.push(`Due in ${Math.round(d)}d — no rush`); }
    }
  }

  const text = `${task.title} ${task.description ?? ""}`;
  if (URGENT_WORDS.test(text)) {
    score = Math.min(100, score + 30);
    reasons.push("Marked urgent in text");
  } else if (TODAY_WORDS.test(text) && score < 85) {
    score = Math.max(score, 85);
    reasons.push("Mentions today");
  } else if (NOT_URGENT_WORDS.test(text)) {
    score = Math.min(score, 20);
    reasons.push("Explicitly low urgency");
  }

  const postpones = task.postpone_count ?? 0;
  if (postpones >= 3) {
    score = Math.min(100, score + 15);
    reasons.push(`Postponed ${postpones}× — becoming urgent by neglect`);
  }

  if (task.priority === "urgent" && score < 70) {
    score = Math.max(score, 70);
    reasons.push("Priority set to urgent");
  }

  return { score: clamp(score, 0, 100), reasons };
}

const IMPORTANT_WORDS = /\b(important|critical|must|essential|key|strategic|high.?impact|vital|crucial)\b/i;
const NOT_IMPORTANT_WORDS = /\b(optional|nice to have|if time|low.?impact|minor|trivial|unimportant)\b/i;

function scoreImportance(task: ScoringTask, ctx: ScoringContext): ScoreBreakdown {
  let score = 40;
  const reasons: string[] = [];

  if (task.related_goal_id && ctx.activeGoalIds.has(task.related_goal_id)) {
    score += 30;
    const goal = ctx.goalMeta.get(task.related_goal_id);
    reasons.push(`Linked to goal: "${goal?.title ?? "?"}"`);
    if (goal?.deadline) {
      const d = daysUntil(goal.deadline, ctx.now);
      if (d !== null && d < 30) { score += 10; reasons.push("Goal deadline within 30d"); }
    }
  }

  if (task.related_project_id && ctx.activeProjectIds.has(task.related_project_id)) {
    score += 15;
    reasons.push("Linked to active project");
  }

  if (task.related_opportunity_id && ctx.highValueOppIds.has(task.related_opportunity_id)) {
    score += 20;
    reasons.push("Linked to high-value opportunity");
  }

  const text = `${task.title} ${task.description ?? ""}`;
  if (IMPORTANT_WORDS.test(text)) {
    score += 25;
    reasons.push("Marked important in text");
  } else if (NOT_IMPORTANT_WORDS.test(text)) {
    score = Math.max(10, score - 20);
    reasons.push("Explicitly optional/minor");
  }

  return { score: clamp(score, 0, 100), reasons };
}

type Quadrant = "do_now" | "schedule" | "delegate" | "drop";

function assignQuadrant(urgency: number, importance: number): { quadrant: Quadrant; confidence: number } {
  const distU = Math.abs(urgency - 55);
  const distI = Math.abs(importance - 55);
  const minDist = Math.min(distU, distI);
  const confidence = clamp(0.5 + (minDist / 45) * 0.45, 0.5, 0.95);

  let quadrant: Quadrant;
  if (urgency >= 55 && importance >= 55) quadrant = "do_now";
  else if (urgency < 55 && importance >= 55) quadrant = "schedule";
  else if (urgency >= 55 && importance < 55) quadrant = "delegate";
  else quadrant = "drop";

  return { quadrant, confidence: Math.round(confidence * 100) / 100 };
}

// ---- Helpers ----------------------------------------------------------------

const NOW = new Date("2026-06-09T12:00:00Z");

function emptyCtx(overrides?: Partial<ScoringContext>): ScoringContext {
  return {
    now: NOW,
    activeGoalIds: new Set(),
    activeProjectIds: new Set(),
    highValueOppIds: new Set(),
    goalMeta: new Map(),
    ...overrides,
  };
}

// ---- Tests ------------------------------------------------------------------

describe("scoreUrgency", () => {
  it("overdue task → 95", () => {
    const r = scoreUrgency({ title: "Pay bill", due_date: "2026-06-07" }, NOW);
    expect(r.score).toBe(95);
    expect(r.reasons[0]).toContain("Overdue");
  });

  it("due today → 90", () => {
    const r = scoreUrgency({ title: "Pay bill", due_date: "2026-06-09" }, NOW);
    expect(r.score).toBe(90);
  });

  it("due in 2 days → 75", () => {
    const r = scoreUrgency({ title: "Review doc", due_date: "2026-06-11" }, NOW);
    expect(r.score).toBe(75);
  });

  it("due in 5 days → 60", () => {
    const r = scoreUrgency({ title: "Submit form", due_date: "2026-06-14" }, NOW);
    expect(r.score).toBe(60);
  });

  it("due in 15 days → 40", () => {
    const r = scoreUrgency({ title: "Renew license", due_date: "2026-06-24" }, NOW);
    expect(r.score).toBe(40);
  });

  it("due in 60 days → 25", () => {
    const r = scoreUrgency({ title: "Annual review", due_date: "2026-08-08" }, NOW);
    expect(r.score).toBe(25);
  });

  it("no due date → 30 (default)", () => {
    const r = scoreUrgency({ title: "Think about strategy" }, NOW);
    expect(r.score).toBe(30);
  });

  it("'asap' language boosts urgency by 30", () => {
    const r = scoreUrgency({ title: "Fix server ASAP" }, NOW);
    expect(r.score).toBe(60); // 30 + 30
    expect(r.reasons).toContain("Marked urgent in text");
  });

  it("'no rush' caps urgency at 20", () => {
    const r = scoreUrgency({ title: "Clean desk, no rush" }, NOW);
    expect(r.score).toBe(20);
  });

  it("'today' in text boosts to 85", () => {
    const r = scoreUrgency({ title: "Call Sam today" }, NOW);
    expect(r.score).toBe(85);
  });

  it("postpone_count >= 3 adds 15", () => {
    const r = scoreUrgency({ title: "Update resume", postpone_count: 4 }, NOW);
    expect(r.score).toBe(45); // 30 + 15
    expect(r.reasons.some((s) => s.includes("Postponed"))).toBe(true);
  });

  it("priority=urgent sets floor of 70", () => {
    const r = scoreUrgency({ title: "Something", priority: "urgent" }, NOW);
    expect(r.score).toBe(70);
  });

  it("deadline + urgent language stack", () => {
    const r = scoreUrgency({ title: "Critical: fix prod", due_date: "2026-06-11" }, NOW);
    // due in 2d = 75, + critical = +30, capped at 100
    expect(r.score).toBe(100);
  });

  it("'no rush' overrides even with deadline in 5d", () => {
    const r = scoreUrgency({ title: "File report, no rush", due_date: "2026-06-14" }, NOW);
    // due in 5d = 60, but "no rush" caps at 20
    expect(r.score).toBe(20);
  });
});

describe("scoreImportance", () => {
  it("no links, no language → 40 (default)", () => {
    const r = scoreImportance({ title: "Random note" }, emptyCtx());
    expect(r.score).toBe(40);
  });

  it("linked to active goal → +30", () => {
    const ctx = emptyCtx({
      activeGoalIds: new Set(["g1"]),
      goalMeta: new Map([["g1", { title: "Ship MVP" }]]),
    });
    const r = scoreImportance({ title: "Write tests", related_goal_id: "g1" }, ctx);
    expect(r.score).toBe(70); // 40 + 30
    expect(r.reasons[0]).toContain("Ship MVP");
  });

  it("goal with close deadline → +40 total", () => {
    const ctx = emptyCtx({
      activeGoalIds: new Set(["g1"]),
      goalMeta: new Map([["g1", { title: "Launch", deadline: "2026-06-20" }]]),
    });
    const r = scoreImportance({ title: "Deploy", related_goal_id: "g1" }, ctx);
    expect(r.score).toBe(80); // 40 + 30 + 10
  });

  it("goal with far deadline → only +30", () => {
    const ctx = emptyCtx({
      activeGoalIds: new Set(["g1"]),
      goalMeta: new Map([["g1", { title: "Learn piano", deadline: "2027-01-01" }]]),
    });
    const r = scoreImportance({ title: "Practice", related_goal_id: "g1" }, ctx);
    expect(r.score).toBe(70); // 40 + 30, no deadline bonus
  });

  it("linked to active project → +15", () => {
    const ctx = emptyCtx({ activeProjectIds: new Set(["p1"]) });
    const r = scoreImportance({ title: "Update docs", related_project_id: "p1" }, ctx);
    expect(r.score).toBe(55); // 40 + 15
  });

  it("linked to high-value opp → +20", () => {
    const ctx = emptyCtx({ highValueOppIds: new Set(["o1"]) });
    const r = scoreImportance({ title: "Send proposal", related_opportunity_id: "o1" }, ctx);
    expect(r.score).toBe(60); // 40 + 20
  });

  it("'important' language → +25", () => {
    const r = scoreImportance({ title: "Important: review contract" }, emptyCtx());
    expect(r.score).toBe(65); // 40 + 25
  });

  it("'nice to have' language → −20", () => {
    const r = scoreImportance({ title: "Nice to have: dark mode" }, emptyCtx());
    expect(r.score).toBe(20); // 40 - 20
  });

  it("multiple links stack", () => {
    const ctx = emptyCtx({
      activeGoalIds: new Set(["g1"]),
      activeProjectIds: new Set(["p1"]),
      highValueOppIds: new Set(["o1"]),
      goalMeta: new Map([["g1", { title: "Revenue" }]]),
    });
    const r = scoreImportance({
      title: "Close deal",
      related_goal_id: "g1",
      related_project_id: "p1",
      related_opportunity_id: "o1",
    }, ctx);
    expect(r.score).toBe(100); // 40+30+15+20 = 105 → clamped to 100
  });

  it("inactive goal is ignored", () => {
    const ctx = emptyCtx({
      activeGoalIds: new Set(), // g1 NOT active
      goalMeta: new Map([["g1", { title: "Old goal" }]]),
    });
    const r = scoreImportance({ title: "Task", related_goal_id: "g1" }, ctx);
    expect(r.score).toBe(40); // no bonus
  });
});

describe("assignQuadrant", () => {
  it("high urgency + high importance → do_now", () => {
    const r = assignQuadrant(80, 75);
    expect(r.quadrant).toBe("do_now");
    expect(r.confidence).toBeGreaterThanOrEqual(0.7);
  });

  it("low urgency + high importance → schedule", () => {
    const r = assignQuadrant(30, 80);
    expect(r.quadrant).toBe("schedule");
  });

  it("high urgency + low importance → delegate", () => {
    const r = assignQuadrant(80, 30);
    expect(r.quadrant).toBe("delegate");
  });

  it("low urgency + low importance → drop", () => {
    const r = assignQuadrant(20, 20);
    expect(r.quadrant).toBe("drop");
  });

  it("borderline (55, 55) → do_now with low confidence", () => {
    const r = assignQuadrant(55, 55);
    expect(r.quadrant).toBe("do_now");
    expect(r.confidence).toBe(0.5);
  });

  it("borderline (54, 55) → schedule with low confidence", () => {
    const r = assignQuadrant(54, 55);
    expect(r.quadrant).toBe("schedule");
    expect(r.confidence).toBeLessThanOrEqual(0.52);
  });

  it("far from threshold → high confidence", () => {
    const r = assignQuadrant(100, 100);
    expect(r.confidence).toBe(0.95);
  });

  it("one axis borderline, one clear → moderate confidence", () => {
    const r = assignQuadrant(56, 90);
    // distU=1, distI=35, min=1 → confidence ≈ 0.51
    expect(r.quadrant).toBe("do_now");
    expect(r.confidence).toBeLessThanOrEqual(0.52);
  });
});
