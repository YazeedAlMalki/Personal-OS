import { describe, it, expect } from "vitest";
import { computeTaskPriority } from "@/lib/scoring/priority";
import { activityScore, nutritionScore, recoveryScore } from "@/lib/scoring/health";
import { relationshipHealth, isDrifting } from "@/lib/scoring/relationship";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("computeTaskPriority", () => {
  it("floors urgent tasks at 80", () => {
    expect(computeTaskPriority({ priority: "urgent", now: NOW })).toBeGreaterThanOrEqual(80);
  });
  it("floors due-today/overdue tasks at 80", () => {
    expect(
      computeTaskPriority({ priority: "low", dueDate: "2026-06-10", now: NOW }),
    ).toBeGreaterThanOrEqual(80);
  });
  it("scores a low-priority, no-due task low", () => {
    expect(computeTaskPriority({ priority: "low", now: NOW })).toBeLessThan(30);
  });
  it("stays within 0..100", () => {
    const s = computeTaskPriority({
      priority: "high",
      dueDate: "2026-06-15",
      postponeCount: 10,
      linkedGoalImportance: 1,
      now: NOW,
    });
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(100);
  });
});

describe("health scores", () => {
  it("activity hits 100 at target", () => {
    expect(activityScore({ steps: 8000, activeEnergy: 500, workoutMinutes: 30 })).toBe(100);
  });
  it("activity is 0 with no data", () => {
    expect(activityScore({})).toBe(0);
  });
  it("nutrition hits 100 at target with full logging", () => {
    expect(nutritionScore({ protein: 140, calories: 2200, loggingConsistency7d: 1 })).toBe(100);
  });
  it("recovery hits 100 with ideal inputs", () => {
    expect(
      recoveryScore({ sleepMinutes: 450, sleepConsistency: 1, hrv: 60, restingHeartRate: 60 }),
    ).toBe(100);
  });
  it("recovery drops with high resting HR", () => {
    const good = recoveryScore({ sleepMinutes: 450, sleepConsistency: 1, hrv: 60, restingHeartRate: 60 });
    const bad = recoveryScore({ sleepMinutes: 450, sleepConsistency: 1, hrv: 60, restingHeartRate: 90 });
    expect(bad).toBeLessThan(good);
  });
});

describe("relationship", () => {
  it("is high for a strong, recently-contacted person", () => {
    expect(
      relationshipHealth({ baseStrength: 5, lastContactedAt: "2026-06-10", now: NOW }),
    ).toBeGreaterThan(85);
  });
  it("decays when contact is old", () => {
    expect(
      relationshipHealth({ baseStrength: 5, lastContactedAt: "2025-11-01", now: NOW }),
    ).toBeLessThan(20);
  });
  it("flags drifting contacts", () => {
    expect(isDrifting({ baseStrength: 4, lastContactedAt: "2026-04-20", now: NOW })).toBe(true);
    expect(isDrifting({ baseStrength: 4, lastContactedAt: "2026-06-09", now: NOW })).toBe(false);
  });
});
