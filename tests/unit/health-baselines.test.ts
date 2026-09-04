import { describe, it, expect } from "vitest";
import {
  computeBaselines,
  loggingConsistency,
  priorDayStrain,
  sleepConsistency,
} from "@/lib/scoring/baselines";

describe("computeBaselines", () => {
  it("uses defaults when there are too few readings", () => {
    const b = computeBaselines([
      { resting_heart_rate: 55, hrv: 60 },
      { resting_heart_rate: 56, hrv: 62 },
    ]);
    // Fewer than MIN_DAYS (7) → defaults
    expect(b.estimated).toBe(true);
    expect(b.rhrBaseline).toBe(60); // DEFAULT_TARGETS.rhrBaseline
    expect(b.hrvBaseline).toBe(60);
  });

  it("computes rolling averages once the sample crosses 7 days", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      resting_heart_rate: 50 + i, // 50..59
      hrv: 40 + i, // 40..49
    }));
    const b = computeBaselines(rows);
    expect(b.estimated).toBe(false);
    expect(b.rhrBaseline).toBe(55); // round((50..59)/10) = 54.5 → 55
    expect(b.hrvBaseline).toBe(45); // round((40..49)/10) = 44.5 → 45
  });

  it("falls back to user targets when set", () => {
    const b = computeBaselines([], { rhrBaseline: 48, hrvBaseline: 80 });
    expect(b.rhrBaseline).toBe(48);
    expect(b.hrvBaseline).toBe(80);
  });
});

describe("sleepConsistency", () => {
  it("returns 0 with fewer than 3 valid points", () => {
    expect(sleepConsistency([])).toBe(0);
    expect(sleepConsistency([420])).toBe(0);
  });
  it("returns 1 for perfectly identical sleep", () => {
    expect(sleepConsistency([420, 420, 420, 420, 420])).toBe(1);
  });
  it("penalises wild variance", () => {
    expect(sleepConsistency([300, 540, 240, 600, 360])).toBeLessThan(0.8);
  });
});

describe("loggingConsistency", () => {
  it("counts logged days within the window", () => {
    const today = new Date("2026-06-10T12:00:00Z");
    const dates = new Set(["2026-06-10", "2026-06-09", "2026-06-08", "2026-06-04"]);
    const r = loggingConsistency(dates, today, 7);
    expect(r).toBeCloseTo(4 / 7, 5);
  });
});

describe("priorDayStrain", () => {
  it("is 0 when there's no prior reading", () => {
    expect(priorDayStrain(null, 500)).toBe(0);
  });
  it("scales to 1 at 1.5x target", () => {
    expect(priorDayStrain(750, 500)).toBe(1);
  });
  it("never exceeds 1", () => {
    expect(priorDayStrain(5000, 500)).toBe(1);
  });
});
