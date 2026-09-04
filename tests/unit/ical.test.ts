import { describe, it, expect } from "vitest";
import { parseIcs, parseIcsDate } from "@/lib/integrations/ical";

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

  it("handles all-day and TZID wall-clock dates", () => {
    expect(events[2]!.start).toBe("2026-06-20T00:00:00.000Z");
    expect(events[1]!.start).toBe("2026-06-16T14:00:00.000Z");
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
