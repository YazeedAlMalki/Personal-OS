// §12.5 read-only calendar — RFC 5545 RRULE expansion, no deps.
// Pure date math over *naive wall-clock* components: an occurrence of a 09:00
// weekly meeting is 09:00 local every week, including across a DST change, so
// recurrence must be computed in local wall-clock and only then converted to a
// UTC instant by the caller (lib/integrations/ical.ts owns that conversion).
//
// Supported: FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL, COUNT, UNTIL, BYDAY
// (with ordinals: 2TU, -1FR), BYMONTHDAY (incl. negatives), BYMONTH, WKST.
// Deliberately NOT supported (rare in consumer calendars, and each would need
// its own correctness story): FREQ=SECONDLY/MINUTELY/HOURLY, BYYEARDAY,
// BYWEEKNO, BYSETPOS, BYHOUR/BYMINUTE/BYSECOND. An RRULE using only
// unsupported parts degrades to the master event alone rather than guessing.

export interface WallClock {
  y: number;
  mo: number; // 1-12
  d: number;
  h: number;
  mi: number;
  s: number;
}

const WEEKDAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;

// Naive components ↔ a sortable number. Date.UTC is used purely as calendar
// arithmetic here — these are wall-clock values, not instants.
export function toNaive(w: WallClock): number {
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
}

export function fromNaive(ms: number): WallClock {
  const dt = new Date(ms);
  return {
    y: dt.getUTCFullYear(),
    mo: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    h: dt.getUTCHours(),
    mi: dt.getUTCMinutes(),
    s: dt.getUTCSeconds(),
  };
}

function weekdayOf(naive: number): number {
  return new Date(naive).getUTCDay(); // 0 = Sunday
}

function daysInMonth(y: number, mo: number): number {
  return new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

const DAY_MS = 86_400_000;

interface ByDay {
  ordinal: number | null; // 2 = "second", -1 = "last", null = every
  weekday: number; // 0-6
}

export interface Rrule {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count: number | null;
  until: string | null; // raw ICS value, resolved by the caller
  byDay: ByDay[];
  byMonthDay: number[];
  byMonth: number[];
  wkst: number; // 0-6
}

// "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2" → structured, or null if the rule is
// something this engine will not attempt.
export function parseRrule(raw: string): Rrule | null {
  const parts = new Map<string, string>();
  for (const chunk of raw.split(";")) {
    const eq = chunk.indexOf("=");
    if (eq === -1) continue;
    parts.set(chunk.slice(0, eq).trim().toUpperCase(), chunk.slice(eq + 1).trim());
  }

  const freq = parts.get("FREQ")?.toUpperCase();
  if (freq !== "DAILY" && freq !== "WEEKLY" && freq !== "MONTHLY" && freq !== "YEARLY") {
    return null; // unsupported or absent frequency
  }

  // Parts that would silently change which dates are produced. Bail rather
  // than emit a plausible-looking wrong series.
  for (const unsupported of ["BYYEARDAY", "BYWEEKNO", "BYSETPOS"]) {
    if (parts.has(unsupported)) return null;
  }

  const nums = (key: string): number[] =>
    (parts.get(key) ?? "")
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v !== 0);

  const byDay: ByDay[] = [];
  for (const token of (parts.get("BYDAY") ?? "").split(",")) {
    const m = token.trim().toUpperCase().match(/^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/);
    if (!m) continue;
    byDay.push({
      ordinal: m[1] ? Number(m[1]) : null,
      weekday: WEEKDAYS.indexOf(m[2] as (typeof WEEKDAYS)[number]),
    });
  }

  const interval = Number(parts.get("INTERVAL") ?? 1);
  const count = parts.has("COUNT") ? Number(parts.get("COUNT")) : null;
  const wkstIdx = WEEKDAYS.indexOf(
    (parts.get("WKST") ?? "MO").toUpperCase() as (typeof WEEKDAYS)[number],
  );

  return {
    freq,
    interval: Number.isInteger(interval) && interval > 0 ? interval : 1,
    count: count !== null && Number.isInteger(count) && count > 0 ? count : null,
    until: parts.get("UNTIL") ?? null,
    byDay,
    byMonthDay: nums("BYMONTHDAY"),
    byMonth: nums("BYMONTH").filter((m) => m >= 1 && m <= 12),
    wkst: wkstIdx === -1 ? 1 : wkstIdx,
  };
}

// Hard ceiling on generated occurrences. A daily rule with no COUNT/UNTIL over
// the sync window (~210 days) yields ~210; 2000 leaves generous headroom while
// making a pathological feed impossible to hang on.
const MAX_OCCURRENCES = 2000;
// Ceiling on periods examined, so a rule whose candidates never match anything
// (e.g. BYMONTHDAY=31 on a YEARLY rule in February) terminates.
const MAX_PERIODS = 5000;

// Resolve BYMONTHDAY / BYDAY into the days-of-month they select, ascending.
function daysForMonth(rule: Rrule, y: number, mo: number, fallbackDay: number): number[] {
  const dim = daysInMonth(y, mo);
  const out = new Set<number>();

  if (rule.byMonthDay.length > 0) {
    for (const md of rule.byMonthDay) {
      const day = md > 0 ? md : dim + md + 1;
      if (day >= 1 && day <= dim) out.add(day);
    }
  } else if (rule.byDay.length > 0) {
    for (const bd of rule.byDay) {
      // Every day-of-month sharing this weekday, in order.
      const matches: number[] = [];
      for (let day = 1; day <= dim; day++) {
        if (new Date(Date.UTC(y, mo - 1, day)).getUTCDay() === bd.weekday) matches.push(day);
      }
      if (bd.ordinal === null) {
        for (const day of matches) out.add(day);
      } else {
        const idx = bd.ordinal > 0 ? bd.ordinal - 1 : matches.length + bd.ordinal;
        const day = matches[idx];
        if (day !== undefined) out.add(day);
      }
    }
  } else if (fallbackDay <= dim) {
    // No BY* parts: the rule repeats on DTSTART's day-of-month. Months without
    // that day (Feb for a 31st rule) are skipped, per RFC 5545 §3.3.10.
    out.add(fallbackDay);
  }

  return [...out].sort((a, b) => a - b);
}

/**
 * Expand an RRULE into naive wall-clock occurrence timestamps, ascending,
 * starting at (and including) `startNaive`.
 *
 * `withinWindow` decides whether an occurrence is worth keeping and `pastWindow`
 * stops the walk — both take a naive value. COUNT is applied over *generated*
 * occurrences from DTSTART, including ones the window rejects, so a
 * `COUNT=10` series that began before the window still ends at the right date.
 */
export function expandRrule(
  rule: Rrule,
  startNaive: number,
  opts: {
    untilNaive: number | null;
    withinWindow: (naive: number) => boolean;
    pastWindow: (naive: number) => boolean;
  },
): number[] {
  const start = fromNaive(startNaive);
  const timeOfDay = { h: start.h, mi: start.mi, s: start.s };
  const at = (y: number, mo: number, d: number) =>
    Date.UTC(y, mo - 1, d, timeOfDay.h, timeOfDay.mi, timeOfDay.s);

  const kept: number[] = [];
  let generated = 0;
  let stop = false;

  // Returns false when the caller should stop walking entirely.
  const offer = (naive: number): boolean => {
    if (naive < startNaive) return true; // before DTSTART — not an occurrence
    if (opts.untilNaive !== null && naive > opts.untilNaive) return false;
    generated += 1;
    if (opts.withinWindow(naive)) kept.push(naive);
    if (rule.count !== null && generated >= rule.count) return false;
    if (kept.length >= MAX_OCCURRENCES) return false;
    // Only stop on the window edge once we're past it — a rule can produce
    // out-of-window candidates before in-window ones within the same period.
    return !opts.pastWindow(naive);
  };

  if (rule.freq === "DAILY") {
    const allowed = new Set(rule.byDay.filter((b) => b.ordinal === null).map((b) => b.weekday));
    for (let k = 0; k < MAX_PERIODS && !stop; k++) {
      const naive = startNaive + k * rule.interval * DAY_MS;
      if (allowed.size > 0 && !allowed.has(weekdayOf(naive))) {
        if (opts.pastWindow(naive)) break;
        continue;
      }
      if (!offer(naive)) stop = true;
    }
    return kept;
  }

  if (rule.freq === "WEEKLY") {
    const weekdays =
      rule.byDay.length > 0
        ? [...new Set(rule.byDay.map((b) => b.weekday))]
        : [weekdayOf(startNaive)];
    // Offset of each target weekday from the week-start day, so occurrences
    // come out in calendar order within each week.
    const offsets = weekdays.map((wd) => (wd - rule.wkst + 7) % 7).sort((a, b) => a - b);
    const startOffset = (weekdayOf(startNaive) - rule.wkst + 7) % 7;
    const weekBase = startNaive - startOffset * DAY_MS;

    for (let k = 0; k < MAX_PERIODS && !stop; k++) {
      const base = weekBase + k * rule.interval * 7 * DAY_MS;
      let anyPast = true;
      for (const off of offsets) {
        const naive = base + off * DAY_MS;
        if (naive < startNaive) {
          anyPast = false;
          continue;
        }
        if (!opts.pastWindow(naive)) anyPast = false;
        if (!offer(naive)) {
          stop = true;
          break;
        }
      }
      if (anyPast) break; // the whole week is past the window
    }
    return kept;
  }

  // MONTHLY / YEARLY share the day-selection logic; they differ in how the
  // period advances and which months are in play.
  for (let k = 0; k < MAX_PERIODS && !stop; k++) {
    let months: Array<{ y: number; mo: number }>;
    if (rule.freq === "MONTHLY") {
      const absolute = start.y * 12 + (start.mo - 1) + k * rule.interval;
      months = [{ y: Math.floor(absolute / 12), mo: (absolute % 12) + 1 }];
      if (rule.byMonth.length > 0) months = months.filter((m) => rule.byMonth.includes(m.mo));
    } else {
      const y = start.y + k * rule.interval;
      const list = rule.byMonth.length > 0 ? rule.byMonth : [start.mo];
      months = list.map((mo) => ({ y, mo }));
    }

    let anyPast = months.length > 0;
    for (const { y, mo } of months) {
      for (const day of daysForMonth(rule, y, mo, start.d)) {
        const naive = at(y, mo, day);
        if (naive < startNaive) {
          anyPast = false;
          continue;
        }
        if (!opts.pastWindow(naive)) anyPast = false;
        if (!offer(naive)) {
          stop = true;
          break;
        }
      }
      if (stop) break;
    }
    if (anyPast && !stop) {
      // Every candidate this period was past the window — but a period with no
      // candidates at all (Feb for a 31st rule) must not be read as "past", or
      // the walk would stop early.
      const producedNothing = months.every(
        (m) => daysForMonth(rule, m.y, m.mo, start.d).length === 0,
      );
      if (!producedNothing) break;
    }
  }

  return kept;
}
