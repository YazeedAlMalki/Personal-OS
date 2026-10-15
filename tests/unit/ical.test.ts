import { describe, it, expect, afterEach, vi } from "vitest";
import { allDayLastDate, parseIcs, parseIcsDate } from "@/lib/integrations/ical";
import { eventDayKey, formatEventWhen } from "@/lib/domains/calendar-format";

const SAMPLE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "BEGIN:VEVENT",
  "UID:evt-1@example.com",
  "SUMMARY:Standup with team\\, weekly",
  "DTSTART:20260615T090000Z",
  "DTEND:20260615T093000Z",
  "LOCATION:Zoom",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-2@example.com",
  "SUMMARY:Dentist appointment that has a very long fol",
  " ded line continuation",
  "DTSTART;TZID=Asia/Riyadh:20260616T140000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-3@example.com",
  "SUMMARY:All-day thing",
  "DTSTART;VALUE=DATE:20260620",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:evt-4@example.com",
  "SUMMARY:Quoted TZID with its own DTEND zone",
  "DTSTART;TZID=\"Asia/Riyadh\":20260618T080000",
  "DTEND;TZID=Europe/London:20260618T090000",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "SUMMARY:No UID — must be skipped",
  "DTSTART:20260617T100000Z",
  "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("parseIcs", () => {
  const events = parseIcs(SAMPLE);

  it("parses VEVENTs with UID + DTSTART, skips those without", () => {
    expect(events.map((e) => e.uid)).toEqual([
      "evt-1@example.com",
      "evt-2@example.com",
      "evt-3@example.com",
      "evt-4@example.com",
    ]);
  });

  it("unescapes text and keeps location", () => {
    expect(events[0]!.title).toBe("Standup with team, weekly");
    expect(events[0]!.location).toBe("Zoom");
  });

  it("unfolds RFC 5545 folded lines", () => {
    expect(events[1]!.title).toBe("Dentist appointment that has a very long folded line continuation");
  });

  it("UTC timestamps round-trip exactly", () => {
    expect(events[0]!.start).toBe("2026-06-15T09:00:00.000Z");
    expect(events[0]!.end).toBe("2026-06-15T09:30:00.000Z");
  });

  it("keeps all-day DATE values at UTC midnight (a date, not an instant)", () => {
    expect(events[2]!.start).toBe("2026-06-20T00:00:00.000Z");
  });

  it("resolves a TZID-tagged local time to the real UTC instant", () => {
    // 14:00 in Asia/Riyadh (UTC+3, no DST) is 11:00Z — not 14:00Z.
    expect(events[1]!.start).toBe("2026-06-16T11:00:00.000Z");
  });
});

describe("parseIcsDate timezone handling", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("applies the correct DST offset for the date in question", () => {
    // America/New_York: EDT (UTC-4) in June, EST (UTC-5) in January.
    expect(parseIcsDate("20260616T140000", "America/New_York")).toBe("2026-06-16T18:00:00.000Z");
    expect(parseIcsDate("20260115T140000", "America/New_York")).toBe("2026-01-15T19:00:00.000Z");
  });

  it("interprets a floating time (no Z, no TZID) in USER_TIMEZONE", () => {
    vi.stubEnv("USER_TIMEZONE", "Asia/Riyadh");
    expect(parseIcsDate("20260616T140000")).toBe("2026-06-16T11:00:00.000Z");
  });

  it("falls back to UTC when USER_TIMEZONE is unset", () => {
    vi.stubEnv("USER_TIMEZONE", "");
    expect(parseIcsDate("20260616T140000")).toBe("2026-06-16T14:00:00.000Z");
  });

  it("treats an unrecognised TZID as UTC rather than throwing", () => {
    expect(parseIcsDate("20260616T140000", "Mars/Olympus_Mons")).toBe("2026-06-16T14:00:00.000Z");
  });

  it("ignores a TZID on a UTC (Z-suffixed) value", () => {
    expect(parseIcsDate("20260616T140000Z", "Asia/Riyadh")).toBe("2026-06-16T14:00:00.000Z");
  });

  it("does not shift all-day dates even with a TZID present", () => {
    expect(parseIcsDate("20260620", "Asia/Riyadh")).toBe("2026-06-20T00:00:00.000Z");
  });
});

describe("parseIcs TZID parameters", () => {
  const events = parseIcs(SAMPLE);

  it("handles a quoted TZID and a DTEND in a different zone", () => {
    // 08:00 Riyadh (UTC+3) = 05:00Z; 09:00 London (BST, UTC+1) = 08:00Z.
    expect(events[3]!.start).toBe("2026-06-18T05:00:00.000Z");
    expect(events[3]!.end).toBe("2026-06-18T08:00:00.000Z");
  });
});

describe("parseIcsDate", () => {
  it("rejects garbage", () => {
    expect(parseIcsDate("not-a-date")).toBeNull();
  });
  it("parses bare dates", () => {
    expect(parseIcsDate("20261231")).toBe("2026-12-31T00:00:00.000Z");
  });
});

describe("all-day events", () => {
  const ALL_DAY = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "UID:one-day@example.com",
    "SUMMARY:National Day",
    "DTSTART;VALUE=DATE:20260923",
    "DTEND;VALUE=DATE:20260924",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:multi-day@example.com",
    "SUMMARY:Conference",
    "DTSTART;VALUE=DATE:20261020",
    "DTEND;VALUE=DATE:20261023",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:timed@example.com",
    "SUMMARY:Meeting",
    "DTSTART:20261020T060000Z",
    "DTEND:20261020T070000Z",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const [oneDay, multiDay, timed] = parseIcs(ALL_DAY);

  it("flags VALUE=DATE events as allDay, timed events not", () => {
    expect(oneDay!.allDay).toBe(true);
    expect(multiDay!.allDay).toBe(true);
    expect(timed!.allDay).toBe(false);
    expect(parseIcs(SAMPLE)[2]!.allDay).toBe(true); // DTSTART only, no DTEND
  });

  it("keeps the exclusive DTEND but displays end minus one day", () => {
    expect(oneDay!.start).toBe("2026-09-23T00:00:00.000Z");
    expect(oneDay!.end).toBe("2026-09-24T00:00:00.000Z");
    expect(allDayLastDate(oneDay!.start, oneDay!.end)).toBe("2026-09-23");
  });

  it("handles a multi-day all-day event", () => {
    expect(allDayLastDate(multiDay!.start, multiDay!.end)).toBe("2026-10-22");
    const row = { start_time: multiDay!.start, end_time: multiDay!.end, all_day: true };
    expect(formatEventWhen(row, "Asia/Riyadh")).toBe("All day · until 2026-10-22");
  });

  it("a missing or degenerate DTEND means a single day", () => {
    expect(allDayLastDate("2026-06-20T00:00:00.000Z", null)).toBe("2026-06-20");
    expect(allDayLastDate("2026-06-20T00:00:00.000Z", "2026-06-20T00:00:00.000Z")).toBe("2026-06-20");
  });

  it("renders all-day as 'All day' with no time, on the right date in any zone", () => {
    const row = { start_time: oneDay!.start, end_time: oneDay!.end, all_day: true };
    for (const tz of ["Asia/Riyadh", "America/Los_Angeles", "Pacific/Auckland"]) {
      expect(formatEventWhen(row, tz)).toBe("All day");
      expect(eventDayKey(row, tz)).toBe("2026-09-23");
    }
  });

  it("renders timed events in the user's zone, not UTC", () => {
    const row = { start_time: timed!.start, end_time: timed!.end, all_day: false };
    expect(formatEventWhen(row, "Asia/Riyadh")).toBe("09:00–10:00");
    // 23:30Z on the 19th is already the 20th in Riyadh.
    expect(eventDayKey({ start_time: "2026-10-19T23:30:00.000Z", end_time: null }, "Asia/Riyadh")).toBe(
      "2026-10-20",
    );
  });

  it("recurring all-day series carry the flag on every occurrence", () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VEVENT",
      "UID:bday@example.com",
      "SUMMARY:Birthday",
      "DTSTART;VALUE=DATE:20260101",
      "DTEND;VALUE=DATE:20260102",
      "RRULE:FREQ=YEARLY",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const occ = parseIcs(ics, { from: Date.UTC(2026, 0, 1), to: Date.UTC(2028, 0, 2) });
    expect(occ.length).toBe(3);
    expect(occ.every((e) => e.allDay)).toBe(true);
    expect(occ[1]!.start).toBe("2027-01-01T00:00:00.000Z");
  });
});
