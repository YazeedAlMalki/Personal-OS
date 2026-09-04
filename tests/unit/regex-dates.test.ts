import { describe, expect, it } from "vitest";
import { parseDueDate, dateUrgency, regexClassify } from "@/lib/ai/regex";

// Fixed reference: Tuesday 2026-06-23
const REF = new Date("2026-06-23T10:00:00.000Z"); // Tuesday

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ── parseDueDate ──────────────────────────────────────────────────────────────

describe("parseDueDate — relative anchors", () => {
  it("today", () => expect(parseDueDate("finish today", REF)).toBe("2026-06-23"));
  it("tonight", () => expect(parseDueDate("call tonight", REF)).toBe("2026-06-23"));
  it("tomorrow", () => expect(parseDueDate("Call Sam tomorrow", REF)).toBe("2026-06-24"));
  it("in 3 days", () => expect(parseDueDate("submit in 3 days", REF)).toBe("2026-06-26"));
  it("in 2 weeks", () => expect(parseDueDate("review in 2 weeks", REF)).toBe("2026-07-07"));
  it("in 1 month", () => expect(parseDueDate("follow up in 1 month", REF)).toBe("2026-07-23"));
  it("null for no date", () => expect(parseDueDate("buy milk", REF)).toBeNull());
});

describe("parseDueDate — weekday names", () => {
  // REF is Tuesday (day 2)
  it("friday (upcoming)", () => expect(parseDueDate("send by friday", REF)).toBe("2026-06-26"));
  it("monday (next week)", () => expect(parseDueDate("meet on monday", REF)).toBe("2026-06-29"));
  it("tuesday (same day → next week)", () => expect(parseDueDate("check on tuesday", REF)).toBe("2026-06-30"));
  it("next monday → skip this week", () => expect(parseDueDate("ping next monday", REF)).toBe("2026-07-06"));
  it("next friday", () => expect(parseDueDate("demo next friday", REF)).toBe("2026-07-03"));
  it("next week → coming Monday", () => expect(parseDueDate("tackle next week", REF)).toBe("2026-06-29"));
});

describe("parseDueDate — week/month anchors", () => {
  it("this week → Friday", () => expect(parseDueDate("close this week", REF)).toBe("2026-06-26"));
  it("end of week → Friday", () => expect(parseDueDate("done end of week", REF)).toBe("2026-06-26"));
  it("eow → Friday", () => expect(parseDueDate("ship eow", REF)).toBe("2026-06-26"));
  it("this month → EOM", () => expect(parseDueDate("pay this month", REF)).toBe("2026-06-30"));
  it("end of month → EOM", () => expect(parseDueDate("invoice end of month", REF)).toBe("2026-06-30"));
  it("eom → EOM", () => expect(parseDueDate("expenses eom", REF)).toBe("2026-06-30"));
});

describe("parseDueDate — named-month dates", () => {
  it("Jan 15 → next year (past)", () => expect(parseDueDate("file by Jan 15", REF)).toBe("2027-01-15"));
  it("August 3rd → this year (future)", () => expect(parseDueDate("meeting August 3rd", REF)).toBe("2026-08-03"));
  it("15 Jan → next year (past)", () => expect(parseDueDate("renew 15 Jan", REF)).toBe("2027-01-15"));
  it("3rd August → this year", () => expect(parseDueDate("event 3rd August", REF)).toBe("2026-08-03"));
  it("sep. 1 → this year", () => expect(parseDueDate("start sep. 1", REF)).toBe("2026-09-01"));
  it("December 31 → this year", () => expect(parseDueDate("deadline December 31", REF)).toBe("2026-12-31"));
});

describe("parseDueDate — numeric slash dates", () => {
  it("8/15 → Aug 15 this year", () => expect(parseDueDate("due 8/15", REF)).toBe("2026-08-15"));
  it("1/5 → Jan 5 next year (past)", () => expect(parseDueDate("submit 1/5", REF)).toBe("2027-01-05"));
  it("12/31/2027 → exact", () => expect(parseDueDate("expires 12/31/2027", REF)).toBe("2027-12-31"));
});

// ── dateUrgency ───────────────────────────────────────────────────────────────

describe("dateUrgency", () => {
  it("same day → today", () => expect(dateUrgency("2026-06-23", REF)).toBe("today"));
  it("yesterday → today (overdue)", () => expect(dateUrgency("2026-06-22", REF)).toBe("today"));
  it("tomorrow → this_week", () => expect(dateUrgency("2026-06-24", REF)).toBe("this_week"));
  it("+7 days → this_week", () => expect(dateUrgency("2026-06-30", REF)).toBe("this_week"));
  it("+8 days → this_month", () => expect(dateUrgency("2026-07-01", REF)).toBe("this_month"));
  it("+31 days → this_month", () => expect(dateUrgency("2026-07-24", REF)).toBe("this_month"));
  it("+32 days → someday", () => expect(dateUrgency("2026-07-25", REF)).toBe("someday"));
});

// ── regexClassify integration ─────────────────────────────────────────────────

describe("regexClassify — date propagation", () => {
  it("sets due_date and urgency from 'tomorrow'", () => {
    const r = regexClassify("Call Sam tomorrow", REF);
    expect(r.due_date).toBe("2026-06-24");
    expect(r.urgency).toBe("this_week");
    expect(r.kind).toBe("task");
  });

  it("sets due_date from weekday", () => {
    const r = regexClassify("Send proposal on Friday", REF);
    expect(r.due_date).toBe("2026-06-26");
    expect(r.urgency).toBe("this_week");
  });

  it("explicit urgency keyword wins over date-derived", () => {
    // "asap" → "today" even though "next week" parses to a future date
    const r = regexClassify("review this asap next week", REF);
    expect(r.urgency).toBe("today");
  });

  it("null due_date when no date phrase", () => {
    const r = regexClassify("Buy groceries someday", REF);
    expect(r.due_date).toBeNull();
    expect(r.urgency).toBe("someday");
  });

  it("sets this_month urgency from EOM date", () => {
    const r = regexClassify("submit expenses eom", REF);
    expect(r.due_date).toBe("2026-06-30");
    expect(r.urgency).toBe("this_week"); // EOM is Jun 30 = 7 days from Jun 23 → this_week
  });

  it("today urgency from named date matching today", () => {
    const r = regexClassify("finish this today", REF);
    expect(r.due_date).toBe("2026-06-23");
    expect(r.urgency).toBe("today");
  });
});
