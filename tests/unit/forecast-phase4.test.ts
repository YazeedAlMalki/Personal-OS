import { describe, it, expect } from "vitest";
import {
  pipelineDelta,
  sleepTrend,
  stepTrend,
  taskCompletionRisk,
  weightTrend,
  workoutConsistency,
} from "@/lib/forecast";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("taskCompletionRisk", () => {
  it("is 0 for done tasks", () => {
    expect(
      taskCompletionRisk({ status: "done", postponeCount: 5, now: NOW }).risk,
    ).toBe(0);
  });
  it("is high when overdue + postponed", () => {
    const r = taskCompletionRisk({
      status: "todo",
      postponeCount: 4,
      dueDate: "2026-06-05",
      now: NOW,
    });
    expect(r.risk).toBeGreaterThanOrEqual(0.65);
  });
  it("blocked floor at 0.7", () => {
    expect(
      taskCompletionRisk({
        status: "blocked",
        priorityScore: 90,
        now: NOW,
      }).risk,
    ).toBeGreaterThanOrEqual(0.7);
  });
});

describe("sleepTrend", () => {
  it("flags 3 nights below target", () => {
    const r = sleepTrend([
      { date: "1", sleep_minutes: 360 },
      { date: "2", sleep_minutes: 350 },
      { date: "3", sleep_minutes: 340 },
    ]);
    expect(r.threeBelow).toBe(true);
    expect(r.avg7).not.toBeNull();
  });
  it("does not flag when one night is above target", () => {
    const r = sleepTrend([
      { date: "1", sleep_minutes: 360 },
      { date: "2", sleep_minutes: 480 },
      { date: "3", sleep_minutes: 340 },
    ]);
    expect(r.threeBelow).toBe(false);
  });
});

describe("stepTrend", () => {
  it("reports avg and pct of target", () => {
    const r = stepTrend(
      Array.from({ length: 7 }, (_, i) => ({ date: String(i), steps: 4000 })),
      8000,
    );
    expect(r.avg7).toBe(4000);
    expect(r.pctOfTarget).toBe(0.5);
  });
});

describe("weightTrend", () => {
  it("reports positive weekly slope on increase", () => {
    const r = weightTrend(
      Array.from({ length: 14 }, (_, i) => ({ date: String(i), weight_kg: 70 + i * 0.1 })),
    );
    expect(r.slopePerWeek).toBeGreaterThan(0);
    expect(r.latest).toBe(70 + 13 * 0.1);
  });
});

describe("workoutConsistency", () => {
  it("counts streak weeks at or above target", () => {
    const days = Array.from({ length: 12 }, (_, i) => ({
      date: new Date(NOW.getTime() - i * 86400000).toISOString().slice(0, 10),
    }));
    const r = workoutConsistency(days, 3, 4, NOW);
    expect(r.sessionsPerWeek).toBeGreaterThan(0);
    expect(r.streakWeeks).toBeGreaterThan(0);
  });
});

describe("pipelineDelta", () => {
  it("flags 25% drop down", () => {
    const d = pipelineDelta(75, 100);
    expect(d.direction).toBe("down");
    expect(Math.abs(d.deltaPct)).toBeGreaterThanOrEqual(0.2);
  });
  it("flat for small change", () => {
    expect(pipelineDelta(101, 100).direction).toBe("flat");
  });
});
