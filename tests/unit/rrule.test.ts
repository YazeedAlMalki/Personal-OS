import { describe, it, expect } from "vitest";
import { parseIcs } from "@/lib/integrations/ical";
import { parseRrule } from "@/lib/integrations/rrule";

// Wide window so expansion isn't the thing under test here.
const WINDOW = { from: Date.UTC(2026, 0, 1), to: Date.UTC(2027, 0, 1) };

function ics(...vevents: string[][]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    ...vevents.flatMap((v) => ["BEGIN:VEVENT", ...v, "END:VEVENT"]),
    "END:VCALENDAR",
  ].join("\r\n");
}

const starts = (out: ReturnType<typeof parseIcs>) => out.map((e) => e.start);

describe("parseRrule", () => {
  it("reads the parts it supports", () => {
    const r = parseRrule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5;WKST=SU")!;
    expect(r.freq).toBe("WEEKLY");
    expect(r.interval).toBe(2);
    expect(r.count).toBe(5);
    expect(r.byDay.map((b) => b.weekday)).toEqual([1, 3]);
    expect(r.wkst).toBe(0);
  });

  it("returns null for rules it will not attempt, rather than guessing", () => {
    expect(parseRrule("FREQ=HOURLY;INTERVAL=6")).toBeNull();
    expect(parseRrule("FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR")).toBeNull();
    expect(parseRrule("FREQ=YEARLY;BYWEEKNO=20")).toBeNull();
    expect(parseRrule("INTERVAL=2")).toBeNull();
  });

  it("defaults a missing or nonsensical INTERVAL to 1", () => {
    expect(parseRrule("FREQ=DAILY")!.interval).toBe(1);
    expect(parseRrule("FREQ=DAILY;INTERVAL=0")!.interval).toBe(1);
  });
});

describe("RRULE expansion", () => {
  it("expands a weekly meeting into one event per occurrence", () => {
    const out = parseIcs(
      ics([
        "UID:weekly@example.com",
        "SUMMARY:Standup",
        "DTSTART:20260602T090000Z",
        "DTEND:20260602T093000Z",
        "RRULE:FREQ=WEEKLY;COUNT=4",
      ]),
      WINDOW,
    );
    expect(starts(out)).toEqual([
      "2026-06-02T09:00:00.000Z",
      "2026-06-09T09:00:00.000Z",
      "2026-06-16T09:00:00.000Z",
      "2026-06-23T09:00:00.000Z",
    ]);
    // Duration is carried onto every occurrence.
    expect(out[2]!.end).toBe("2026-06-16T09:30:00.000Z");
  });

  it("gives every occurrence a distinct externalId but the same uid", () => {
    const out = parseIcs(
      ics([
        "UID:weekly@example.com",
        "DTSTART:20260602T090000Z",
        "RRULE:FREQ=WEEKLY;COUNT=2",
      ]),
      WINDOW,
    );
    expect(out.map((e) => e.externalId)).toEqual([
      "weekly@example.com_20260602T090000Z",
      "weekly@example.com_20260609T090000Z",
    ]);
    expect(new Set(out.map((e) => e.uid)).size).toBe(1);
  });

  it("leaves a non-recurring event's externalId as its bare uid", () => {
    const out = parseIcs(ics(["UID:once@example.com", "DTSTART:20260602T090000Z"]), WINDOW);
    expect(out[0]!.externalId).toBe("once@example.com");
  });

  it("honours BYDAY with multiple weekdays and INTERVAL", () => {
    const out = parseIcs(
      ics([
        "UID:biweekly@example.com",
        "DTSTART:20260601T080000Z", // a Monday
        "RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=4",
      ]),
      WINDOW,
    );
    expect(starts(out)).toEqual([
      "2026-06-01T08:00:00.000Z",
      "2026-06-03T08:00:00.000Z",
      "2026-06-15T08:00:00.000Z",
      "2026-06-17T08:00:00.000Z",
    ]);
  });

  it("stops at UNTIL", () => {
    const out = parseIcs(
      ics([
        "UID:until@example.com",
        "DTSTART:20260602T090000Z",
        "RRULE:FREQ=WEEKLY;UNTIL=20260616T090000Z",
      ]),
      WINDOW,
    );
    expect(starts(out)).toEqual([
      "2026-06-02T09:00:00.000Z",
      "2026-06-09T09:00:00.000Z",
      "2026-06-16T09:00:00.000Z",
    ]);
  });

  it("handles monthly-by-ordinal-weekday, including 'last'", () => {
    const second = parseIcs(
      ics([
        "UID:m1@example.com",
        "DTSTART:20260609T100000Z",
        "RRULE:FREQ=MONTHLY;BYDAY=2TU;COUNT=3",
      ]),
      WINDOW,
    );
    expect(starts(second)).toEqual([
      "2026-06-09T10:00:00.000Z",
      "2026-07-14T10:00:00.000Z",
      "2026-08-11T10:00:00.000Z",
    ]);

    const last = parseIcs(
      ics([
        "UID:m2@example.com",
        "DTSTART:20260626T100000Z",
        "RRULE:FREQ=MONTHLY;BYDAY=-1FR;COUNT=3",
      ]),
      WINDOW,
    );
    expect(starts(last)).toEqual([
      "2026-06-26T10:00:00.000Z",
      "2026-07-31T10:00:00.000Z",
      "2026-08-28T10:00:00.000Z",
    ]);
  });

  it("skips months that lack the day-of-month, per RFC 5545 §3.3.10", () => {
    const out = parseIcs(
      ics([
        "UID:m31@example.com",
        "DTSTART:20260131T120000Z",
        "RRULE:FREQ=MONTHLY;COUNT=3",
      ]),
      { from: Date.UTC(2026, 0, 1), to: Date.UTC(2026, 11, 31) },
    );
    // February and April have no 31st — March and May take their place.
    expect(starts(out)).toEqual([
      "2026-01-31T12:00:00.000Z",
      "2026-03-31T12:00:00.000Z",
      "2026-05-31T12:00:00.000Z",
    ]);
  });

  it("supports negative BYMONTHDAY (last day of the month)", () => {
    const out = parseIcs(
      ics([
        "UID:eom@example.com",
        "DTSTART:20260131T120000Z",
        "RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=3",
      ]),
      WINDOW,
    );
    expect(starts(out)).toEqual([
      "2026-01-31T12:00:00.000Z",
      "2026-02-28T12:00:00.000Z",
      "2026-03-31T12:00:00.000Z",
    ]);
  });

  it("expands yearly events", () => {
    const out = parseIcs(
      ics([
        "UID:bday@example.com",
        "DTSTART;VALUE=DATE:20260714",
        "RRULE:FREQ=YEARLY;COUNT=2",
      ]),
      { from: Date.UTC(2026, 0, 1), to: Date.UTC(2028, 0, 1) },
    );
    expect(starts(out)).toEqual(["2026-07-14T00:00:00.000Z", "2027-07-14T00:00:00.000Z"]);
  });

  it("removes EXDATE occurrences", () => {
    const out = parseIcs(
      ics([
        "UID:exd@example.com",
        "DTSTART:20260602T090000Z",
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE:20260609T090000Z,20260623T090000Z",
      ]),
      WINDOW,
    );
    expect(starts(out)).toEqual(["2026-06-02T09:00:00.000Z", "2026-06-16T09:00:00.000Z"]);
  });

  it("applies a RECURRENCE-ID override in place of the generated instance", () => {
    const out = parseIcs(
      ics(
        [
          "UID:ovr@example.com",
          "SUMMARY:Standup",
          "DTSTART:20260602T090000Z",
          "DTEND:20260602T093000Z",
          "RRULE:FREQ=WEEKLY;COUNT=3",
        ],
        [
          "UID:ovr@example.com",
          "SUMMARY:Standup (moved)",
          "RECURRENCE-ID:20260609T090000Z",
          "DTSTART:20260610T140000Z",
          "DTEND:20260610T150000Z",
        ],
      ),
      WINDOW,
    );
    expect(starts(out)).toEqual([
      "2026-06-02T09:00:00.000Z",
      "2026-06-10T14:00:00.000Z",
      "2026-06-16T09:00:00.000Z",
    ]);
    expect(out[1]!.title).toBe("Standup (moved)");
    // The override keeps the *original* slot's id, so it replaces that row
    // rather than adding a second one.
    expect(out[1]!.externalId).toBe("ovr@example.com_20260609T090000Z");
  });

  it("keeps a recurring event's local time across a DST change", () => {
    const out = parseIcs(
      ics([
        "UID:dst@example.com",
        "DTSTART;TZID=America/New_York:20261025T090000", // EDT, UTC-4
        "RRULE:FREQ=WEEKLY;COUNT=2",
      ]),
      { from: Date.UTC(2026, 9, 1), to: Date.UTC(2026, 11, 1) },
    );
    // Clocks go back on 2026-11-01: 09:00 local stays 09:00, so the UTC
    // instant shifts by an hour rather than the local time drifting.
    expect(starts(out)).toEqual(["2026-10-25T13:00:00.000Z", "2026-11-01T14:00:00.000Z"]);
  });

  it("bounds an open-ended series to the expansion window", () => {
    const out = parseIcs(
      ics(["UID:forever@example.com", "DTSTART:20260601T090000Z", "RRULE:FREQ=DAILY"]),
      { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 5, 10, 12, 0, 0) },
    );
    expect(out).toHaveLength(10); // 09:00 on June 1-10 inclusive
    expect(out[9]!.start).toBe("2026-06-10T09:00:00.000Z");
  });

  it("excludes an occurrence that falls past the window edge", () => {
    const out = parseIcs(
      ics(["UID:edge@example.com", "DTSTART:20260601T090000Z", "RRULE:FREQ=DAILY"]),
      // Window ends at midnight on the 10th, before that day's 09:00 slot.
      { from: Date.UTC(2026, 5, 1), to: Date.UTC(2026, 5, 10) },
    );
    expect(out).toHaveLength(9);
  });

  it("counts occurrences from DTSTART even when they precede the window", () => {
    const out = parseIcs(
      ics([
        "UID:count@example.com",
        "DTSTART:20260601T090000Z",
        "RRULE:FREQ=DAILY;COUNT=5",
      ]),
      { from: Date.UTC(2026, 5, 3), to: Date.UTC(2027, 0, 1) },
    );
    // COUNT=5 ends the series on June 5 regardless of the window's start.
    expect(starts(out)).toEqual([
      "2026-06-03T09:00:00.000Z",
      "2026-06-04T09:00:00.000Z",
      "2026-06-05T09:00:00.000Z",
    ]);
  });

  it("falls back to the master event when the rule is unsupported", () => {
    const out = parseIcs(
      ics([
        "UID:unsupported@example.com",
        "DTSTART:20260601T090000Z",
        "RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=MO,TU,WE,TH,FR",
      ]),
      WINDOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.externalId).toBe("unsupported@example.com");
  });
});
