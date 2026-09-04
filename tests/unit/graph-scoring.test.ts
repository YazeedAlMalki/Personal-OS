import { describe, it, expect } from "vitest";
import {
  degreeCentrality,
  importanceScore,
  opportunityValueScore,
  recentMentionScore,
} from "@/lib/scoring/graph";
import { DAY_MS } from "@/lib/scoring/util";

const NOW = new Date("2026-06-10T12:00:00Z");

describe("degreeCentrality", () => {
  it("is 0 with no edges and 1 for the densest node", () => {
    expect(degreeCentrality(0, 5)).toBe(0);
    expect(degreeCentrality(5, 5)).toBe(1);
    expect(degreeCentrality(2, 4)).toBe(0.5);
  });
  it("guards an empty graph (maxDegree 0)", () => {
    expect(degreeCentrality(3, 0)).toBe(0);
  });
});

describe("opportunityValueScore", () => {
  it("normalizes against the richest-linked entity", () => {
    expect(opportunityValueScore(50_000, 50_000)).toBe(1);
    expect(opportunityValueScore(25_000, 50_000)).toBe(0.5);
    expect(opportunityValueScore(0, 50_000)).toBe(0);
    expect(opportunityValueScore(10, 0)).toBe(0);
  });
});

describe("recentMentionScore", () => {
  it("is 0 when never mentioned", () => {
    expect(recentMentionScore(0, null, NOW)).toBe(0);
    expect(recentMentionScore(5, null, NOW)).toBe(0);
    expect(recentMentionScore(0, NOW.toISOString(), NOW)).toBe(0);
  });
  it("decays with a 14-day half-life", () => {
    const fresh = recentMentionScore(10, NOW.toISOString(), NOW);
    const old = recentMentionScore(10, new Date(NOW.getTime() - 14 * DAY_MS).toISOString(), NOW);
    expect(old).toBeCloseTo(fresh / 2, 6);
  });
  it("saturates volume around 20 mentions", () => {
    const at20 = recentMentionScore(20, NOW.toISOString(), NOW);
    const at200 = recentMentionScore(200, NOW.toISOString(), NOW);
    expect(at20).toBeCloseTo(1, 2);
    expect(at200).toBe(1);
  });
  it("more mentions never scores lower", () => {
    const a = recentMentionScore(1, NOW.toISOString(), NOW);
    const b = recentMentionScore(5, NOW.toISOString(), NOW);
    expect(b).toBeGreaterThan(a);
  });
});

describe("importanceScore (degree·50 + oppValue·30 + mentions·20)", () => {
  it("maxes at ~100 for a max-everything node", () => {
    const s = importanceScore({
      degree: 4,
      maxDegree: 4,
      linkedOpportunityValue: 50_000,
      maxLinkedOpportunityValue: 50_000,
      mentionCount: 50,
      lastMentionedAt: NOW.toISOString(),
      now: NOW,
    });
    expect(s).toBeCloseTo(100, 0);
  });
  it("is 0 for an orphan node never mentioned", () => {
    const s = importanceScore({
      degree: 0,
      maxDegree: 4,
      linkedOpportunityValue: 0,
      maxLinkedOpportunityValue: 50_000,
      mentionCount: 0,
      lastMentionedAt: null,
      now: NOW,
    });
    expect(s).toBe(0);
  });
  it("weights components 50/30/20", () => {
    const degreeOnly = importanceScore({
      degree: 2, maxDegree: 2,
      linkedOpportunityValue: 0, maxLinkedOpportunityValue: 1,
      mentionCount: 0, lastMentionedAt: null, now: NOW,
    });
    const oppOnly = importanceScore({
      degree: 0, maxDegree: 2,
      linkedOpportunityValue: 1, maxLinkedOpportunityValue: 1,
      mentionCount: 0, lastMentionedAt: null, now: NOW,
    });
    expect(degreeOnly).toBe(50);
    expect(oppOnly).toBe(30);
  });
  it("rounds to 2 decimals (numeric(5,2) column)", () => {
    const s = importanceScore({
      degree: 1, maxDegree: 3,
      linkedOpportunityValue: 0, maxLinkedOpportunityValue: 0,
      mentionCount: 0, lastMentionedAt: null, now: NOW,
    });
    expect(s).toBe(16.67);
  });
});
