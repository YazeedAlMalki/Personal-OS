import { describe, it, expect } from "vitest";
import { scoreRow, qualityScore } from "@/lib/scoring/quality";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("data-quality scoreRow", () => {
  it("completeness = fraction of important fields populated", () => {
    // tasks important fields: title, status, priority, due_date (4)
    const r = scoreRow(
      "tasks",
      { title: "x", status: "todo", priority: null, due_date: null, updated_at: NOW.toISOString() },
      NOW,
    );
    expect(r.completeness).toBe(0.5); // 2 of 4
  });

  it("treats empty strings as missing", () => {
    const r = scoreRow("journal_entries", { content: "   ", entry_date: "2026-06-10", updated_at: NOW.toISOString() }, NOW);
    expect(r.completeness).toBe(0.5); // content blank, entry_date present
  });

  it("freshness decays with age (half-life)", () => {
    // tasks half-life = 30d. updated 30d ago → ~0.5
    const old = new Date(NOW.getTime() - 30 * 86_400_000).toISOString();
    const r = scoreRow("tasks", { title: "x", status: "todo", priority: "high", due_date: "2026-06-11", updated_at: old }, NOW);
    expect(r.freshness).toBeGreaterThan(0.45);
    expect(r.freshness).toBeLessThan(0.55);
  });

  it("fresh rows score ~1 on freshness", () => {
    const r = scoreRow("tasks", { title: "x", status: "todo", priority: "high", due_date: "2026-06-11", updated_at: NOW.toISOString() }, NOW);
    expect(r.freshness).toBeGreaterThan(0.99);
  });

  it("flags consistency issues: probability out of range", () => {
    const r = scoreRow(
      "opportunities",
      { title: "deal", status: "open", probability: 1.5, value: 1000, next_action: "call", updated_at: NOW.toISOString() },
      NOW,
    );
    expect(r.issues.some((i) => i.includes("probability"))).toBe(true);
    expect(r.consistency).toBeLessThan(1);
  });

  it("flags done task missing completed_at", () => {
    const r = scoreRow("tasks", { title: "x", status: "done", priority: "low", due_date: "2026-06-01", completed_at: null, updated_at: NOW.toISOString() }, NOW);
    expect(r.issues.some((i) => i.includes("completed_at"))).toBe(true);
  });

  it("clean row → consistency 1, no issues", () => {
    const r = scoreRow(
      "opportunities",
      { title: "deal", status: "open", probability: 0.4, value: 5000, next_action: "email", updated_at: NOW.toISOString() },
      NOW,
    );
    expect(r.consistency).toBe(1);
    expect(r.issues).toHaveLength(0);
  });

  it("qualityScore mirrors the DB generated column weights", () => {
    const r = { completeness: 1, freshness: 1, consistency: 1, issues: [] };
    expect(qualityScore(r)).toBe(1);
    expect(qualityScore({ completeness: 0.5, freshness: 0, consistency: 1, issues: [] })).toBe(0.45);
  });

  it("unknown table scores neutral (nothing to check)", () => {
    const r = scoreRow("not_a_table", { foo: 1 }, NOW);
    expect(r).toEqual({ completeness: 1, freshness: 1, consistency: 1, issues: [] });
  });
});
