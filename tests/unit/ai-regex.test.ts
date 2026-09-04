import { describe, it, expect } from "vitest";
import { regexClassify } from "@/lib/ai/regex";

describe("regexClassify (zero-model fallback)", () => {
  it("detects an urgent task", () => {
    const c = regexClassify("Call mom today");
    expect(c.kind).toBe("task");
    expect(c.urgency).toBe("today");
    expect(c.priority).toBe("high");
    expect(c.confidence).toBeGreaterThanOrEqual(0.6); // auto-create
  });
  it("detects a journal entry", () => {
    expect(regexClassify("Today I felt grateful and slept well").kind).toBe("journal");
  });
  it("detects an idea", () => {
    expect(regexClassify("What if we built a referral program").kind).toBe("idea");
  });
  it("detects a decision", () => {
    expect(regexClassify("Decided to go with Postgres").kind).toBe("decision");
  });
  it("routes vague text to review (low confidence)", () => {
    const c = regexClassify("hmm stuff");
    expect(c.kind).toBe("note");
    expect(c.confidence).toBeLessThan(0.6);
  });
  it("always returns a non-empty title", () => {
    expect(regexClassify("   ").title.length).toBeGreaterThan(0);
  });
});
