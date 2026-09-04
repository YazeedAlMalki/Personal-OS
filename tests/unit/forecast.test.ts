import { describe, it, expect } from "vitest";
import {
  trendSlope,
  consecutiveBelow,
  deadlineMissRisk,
  goalTrajectory,
  pipelineValue,
  riskExposure,
} from "@/lib/forecast";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("trendSlope", () => {
  it("is +1 for a steady increase", () => {
    expect(trendSlope([1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
  });
  it("is 0 for a flat series", () => {
    expect(trendSlope([5, 5, 5])).toBe(0);
  });
  it("is negative for a decline", () => {
    expect(trendSlope([5, 4, 3])).toBeLessThan(0);
  });
});

describe("consecutiveBelow", () => {
  it("detects N consecutive low values", () => {
    expect(consecutiveBelow([10, 2, 1], 5, 2)).toBe(true);
    expect(consecutiveBelow([10, 9, 2], 5, 2)).toBe(false);
  });
});

describe("deadlineMissRisk", () => {
  it("is 0 when done", () => {
    expect(deadlineMissRisk({ status: "done", dueDate: "2026-06-01", now: NOW }).risk).toBe(0);
  });
  it("is 1 when overdue", () => {
    expect(deadlineMissRisk({ status: "todo", dueDate: "2026-06-01", now: NOW }).risk).toBe(1);
  });
  it("is low for a small task far out", () => {
    expect(
      deadlineMissRisk({ status: "todo", dueDate: "2026-07-10", estimatedMinutes: 60, now: NOW }).risk,
    ).toBeLessThan(0.3);
  });
  it("is high when blocked", () => {
    expect(
      deadlineMissRisk({ status: "blocked", dueDate: "2026-07-10", now: NOW }).risk,
    ).toBeGreaterThanOrEqual(0.7);
  });
});

describe("goalTrajectory", () => {
  it("returns no_deadline when undated", () => {
    expect(goalTrajectory({ progress: 50, now: NOW })).toBe("no_deadline");
  });
  it("is on_track when progress matches elapsed time", () => {
    expect(
      goalTrajectory({ progress: 50, createdAt: "2026-05-31", deadline: "2026-06-20", now: NOW }),
    ).toBe("on_track");
  });
  it("is off_track when far behind", () => {
    expect(
      goalTrajectory({ progress: 5, createdAt: "2026-05-31", deadline: "2026-06-20", now: NOW }),
    ).toBe("off_track");
  });
  it("is off_track when overdue and incomplete", () => {
    expect(goalTrajectory({ progress: 80, deadline: "2026-06-01", now: NOW })).toBe("off_track");
  });
});

describe("pipeline & risk", () => {
  it("sums expected value of active opps only", () => {
    expect(
      pipelineValue([
        { expected_value: 100, status: "new" },
        { expected_value: 50, status: "won" },
        { expected_value: 25, status: "negotiating" },
      ]),
    ).toBe(125);
  });
  it("counts unmitigated high risks, excludes closed", () => {
    const e = riskExposure([
      { risk_score: 16, status: "open" },
      { risk_score: 4, status: "open" },
      { risk_score: 20, status: "closed" },
    ]);
    expect(e.total).toBe(20);
    expect(e.unmitigatedHigh).toBe(1);
  });
});
