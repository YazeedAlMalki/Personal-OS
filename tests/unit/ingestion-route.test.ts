import { describe, it, expect } from "vitest";
import { routeRecord, kindToTable } from "@/lib/ingestion/route";
import type { Classified } from "@/lib/ai/types";

function c(partial: Partial<Classified>): Classified {
  return {
    kind: "note",
    title: "t",
    urgency: "this_week",
    priority: "medium",
    due_date: null,
    confidence: 0.7,
    ...partial,
  };
}

describe("kindToTable", () => {
  it("maps known kinds to tables", () => {
    expect(kindToTable("task")).toBe("tasks");
    expect(kindToTable("opportunity")).toBe("opportunities");
    expect(kindToTable("risk")).toBe("risks");
    expect(kindToTable("decision")).toBe("decisions");
    expect(kindToTable("contact")).toBe("contacts");
    expect(kindToTable("learning")).toBe("learning_items");
  });
  it("routes note/idea/journal/health/finance to journal_entries", () => {
    for (const k of ["note", "idea", "journal", "health", "finance"] as const) {
      expect(kindToTable(k)).toBe("journal_entries");
    }
  });
});

describe("routeRecord", () => {
  it("builds a task row with capture source", () => {
    const r = routeRecord(c({ kind: "task", title: "Call Sam", priority: "high", due_date: "2026-06-12" }), "Call Sam");
    expect(r.table).toBe("tasks");
    expect(r.record).toMatchObject({ title: "Call Sam", priority: "high", due_date: "2026-06-12", source: "capture" });
  });
  it("satisfies risks.category NOT NULL", () => {
    const r = routeRecord(c({ kind: "risk", title: "Vendor lock-in" }), "Vendor lock-in");
    expect(r.table).toBe("risks");
    expect(r.record.category).toBeTruthy();
  });
  it("keeps full raw text on journal route", () => {
    const r = routeRecord(c({ kind: "journal", title: "Felt good" }), "Felt good today, very productive");
    expect(r.table).toBe("journal_entries");
    expect(r.record.raw_text).toBe("Felt good today, very productive");
  });
  it("uses name for contacts", () => {
    expect(routeRecord(c({ kind: "contact", title: "Jane Doe" }), "Jane Doe").record.name).toBe("Jane Doe");
  });
});
