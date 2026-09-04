import { describe, it, expect } from "vitest";
import {
  spearman,
  rank,
  pairByDate,
  strengthOf,
  summarizeCorrelation,
  MIN_PAIRS,
} from "@/lib/analytics/correlate";

describe("rank", () => {
  it("assigns average ranks to ties", () => {
    expect(rank([5, 5, 1])).toEqual([2.5, 2.5, 1]);
  });
});

describe("spearman", () => {
  it("is +1 for a perfect monotonic relationship", () => {
    expect(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50])).toBeCloseTo(1, 6);
  });
  it("is -1 for a perfect inverse relationship", () => {
    expect(spearman([1, 2, 3, 4, 5], [50, 40, 30, 20, 10])).toBeCloseTo(-1, 6);
  });
});

describe("pairByDate", () => {
  it("aligns on shared dates only", () => {
    const a = [
      { date: "2026-06-01", value: 1 },
      { date: "2026-06-02", value: 2 },
      { date: "2026-06-03", value: 3 },
    ];
    const b = [
      { date: "2026-06-02", value: 20 },
      { date: "2026-06-03", value: 30 },
    ];
    expect(pairByDate(a, b)).toEqual({ xs: [2, 3], ys: [20, 30] });
  });
});

describe("strengthOf", () => {
  it("buckets magnitudes", () => {
    expect(strengthOf(0.05)).toBe("negligible");
    expect(strengthOf(0.3)).toBe("weak");
    expect(strengthOf(0.5)).toBe("moderate");
    expect(strengthOf(0.9)).toBe("strong");
  });
});

describe("summarizeCorrelation", () => {
  it("refuses to report below the minimum sample size", () => {
    const r = summarizeCorrelation("sleep", "tasks done", [1, 2, 3], [3, 2, 1]);
    expect(r.rho).toBeNull();
    expect(r.sentence).toContain(String(MIN_PAIRS));
  });
  it("reports with cautious, non-causal wording when enough data", () => {
    const xs = Array.from({ length: 20 }, (_, i) => i);
    const ys = Array.from({ length: 20 }, (_, i) => i * 2);
    const r = summarizeCorrelation("sleep", "tasks done", xs, ys);
    expect(r.rho).toBeCloseTo(1, 6);
    expect(r.strength).toBe("strong");
    expect(r.sentence).toContain("not necessarily causal");
  });
});
