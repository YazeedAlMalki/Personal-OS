// Pure display helpers for calendar_events_cache rows (no server-only import so
// vitest can cover them). Timed events render in USER_TIMEZONE. All-day events
// are calendar dates stored at UTC midnight, so their date is read straight
// from the stored value — formatting them in a local zone would shift the date
// in any zone west of UTC.
import { allDayLastDate } from "@/lib/integrations/ical";

export interface EventTimes {
  start_time: string;
  end_time: string | null;
  all_day?: boolean | null;
}

function localParts(iso: string, timeZone: string): { day: string; time: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** The "YYYY-MM-DD" an event is grouped under, in the user's zone. */
export function eventDayKey(e: EventTimes, timeZone: string): string {
  return e.all_day ? e.start_time.slice(0, 10) : localParts(e.start_time, timeZone).day;
}

/** "All day", "All day · until 2026-06-22", or "09:00–09:30". */
export function formatEventWhen(e: EventTimes, timeZone: string): string {
  if (e.all_day) {
    const last = allDayLastDate(e.start_time, e.end_time);
    return last === e.start_time.slice(0, 10) ? "All day" : `All day · until ${last}`;
  }
  const s = localParts(e.start_time, timeZone);
  if (!e.end_time) return s.time;
  const en = localParts(e.end_time, timeZone);
  return en.day === s.day ? `${s.time}–${en.time}` : `${s.time}–${en.day} ${en.time}`;
}
