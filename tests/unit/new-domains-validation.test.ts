import { describe, it, expect } from "vitest";
import {
  decisionCreate,
  contactCreate,
  journalCreate,
  financeSnapshotCreate,
  learningCreate,
  timeLogCreate,
  calendarEventCreate,
  memorySearch,
  askQuery,
} from "@/lib/security/validation";

describe("new domain validators", () => {
  it("decision: title required, status constrained", () => {
    expect(decisionCreate.safeParse({ title: "Go with Supabase" }).success).toBe(true);
    expect(decisionCreate.safeParse({ title: "" }).success).toBe(false);
    expect(decisionCreate.safeParse({ title: "x", status: "maybe" }).success).toBe(false);
    expect(
      decisionCreate.safeParse({ title: "x", review_date: "2026-07-01", assumption_confidence: 0.8 })
        .success,
    ).toBe(true);
  });

  it("contact: empty email becomes null, bad email rejected", () => {
    const ok = contactCreate.safeParse({ name: "Sam", email: "" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.email).toBeNull();
    expect(contactCreate.safeParse({ name: "Sam", email: "not-an-email" }).success).toBe(false);
    expect(contactCreate.safeParse({ name: "Sam", relationship_strength: 9 }).success).toBe(false);
  });

  it("journal: raw_text required, scales bounded 1..5", () => {
    expect(journalCreate.safeParse({ raw_text: "Good day.", mood: 4 }).success).toBe(true);
    expect(journalCreate.safeParse({ raw_text: "Bad.", mood: 6 }).success).toBe(false);
    expect(journalCreate.safeParse({}).success).toBe(false);
  });

  it("finance: date required, numbers coerced", () => {
    const r = financeSnapshotCreate.safeParse({ date: "2026-06-11", net_worth: "120000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.net_worth).toBe(120000);
    expect(financeSnapshotCreate.safeParse({ net_worth: 1 }).success).toBe(false);
    expect(financeSnapshotCreate.safeParse({ date: "2026-06-11", currency: "usd" }).success).toBe(true);
  });

  it("learning: progress bounded, status constrained", () => {
    expect(learningCreate.safeParse({ title: "Rust", progress_percentage: 50 }).success).toBe(true);
    expect(learningCreate.safeParse({ title: "Rust", progress_percentage: 101 }).success).toBe(false);
    expect(learningCreate.safeParse({ title: "Rust", status: "active" }).success).toBe(true);
  });

  it("time log: ISO datetimes with offset", () => {
    expect(timeLogCreate.safeParse({ start_time: "2026-06-11T09:00:00Z" }).success).toBe(true);
    expect(timeLogCreate.safeParse({ start_time: "yesterday" }).success).toBe(false);
  });

  it("calendar event: title + start required", () => {
    expect(
      calendarEventCreate.safeParse({ title: "Standup", start_time: "2026-06-15T09:00:00Z" }).success,
    ).toBe(true);
    expect(calendarEventCreate.safeParse({ title: "Standup" }).success).toBe(false);
  });

  it("memory search + ask: bounded queries", () => {
    expect(memorySearch.safeParse({ query: "acme", limit: 10 }).success).toBe(true);
    expect(memorySearch.safeParse({ query: "" }).success).toBe(false);
    expect(memorySearch.safeParse({ query: "x", limit: 999 }).success).toBe(false);
    expect(askQuery.safeParse({ question: "what did I decide?" }).success).toBe(true);
  });
});
