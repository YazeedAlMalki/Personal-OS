// §12.5 read-only calendar — minimal ICS (RFC 5545) parser, no deps.
// NOTE: no `import "server-only"` so vitest can import the pure parser
// (same convention as lib/domains/export.ts and health.ts). It still only
// runs server-side — the sole importer is the calendar sync route.
// Works with the private ICS URLs Google Calendar / Outlook / iCloud expose.
//
// Time handling. DTSTART formats: YYYYMMDD (all-day), YYYYMMDDTHHMMSS,
// ...Z (UTC), and TZID-tagged local times, which resolve to real UTC instants
// via the IANA zone name using Intl (handles DST, no VTIMEZONE block needed —
// Google, Outlook and iCloud all emit IANA-named TZIDs). A "floating" local
// time (no Z, no TZID) is interpreted in USER_TIMEZONE, per RFC 5545 §3.3.5.
// All-day DATE values stay at UTC midnight and are deliberately NOT shifted —
// an all-day event is a calendar date, not an instant. Such events carry
// `allDay: true`. Their DTEND is EXCLUSIVE (RFC 5545 §3.6.1): a one-day event
// on the 20th has DTEND the 21st. `end` keeps that exclusive value (correct
// for overlap maths); use allDayLastDate() for the inclusive date to display.
//
// Recurrence. RRULE is expanded (see lib/integrations/rrule.ts) into one event
// per occurrence, with EXDATE exclusions and RECURRENCE-ID overrides applied.
// Expansion runs in wall-clock and converts per occurrence, so a 09:00 weekly
// meeting stays 09:00 local across a DST change. Each occurrence gets its own
// `externalId` (`<uid>_<YYYYMMDDTHHMMSSZ>`, Google's own convention) so the
// upsert key stays unique; a non-recurring event's externalId is just its uid,
// unchanged from before recurrence support existed.

import { expandRrule, parseRrule } from "@/lib/integrations/rrule";

export interface IcsEvent {
  uid: string;
  externalId: string; // uid, or uid_<occurrence> for a recurring instance
  title: string | null;
  start: string; // ISO timestamptz
  end: string | null;
  location: string | null;
  description: string | null;
  allDay: boolean; // VALUE=DATE event: start/end are UTC-midnight dates
}

/**
 * Inclusive last date ("YYYY-MM-DD") of an all-day event. DTEND is exclusive,
 * so it is end minus one day; a missing or degenerate end means a single day.
 */
export function allDayLastDate(startIso: string, endIso: string | null): string {
  const startDay = startIso.slice(0, 10);
  if (!endIso) return startDay;
  const last = new Date(new Date(endIso).getTime() - 86_400_000).toISOString().slice(0, 10);
  return last < startDay ? startDay : last;
}

// Unfold RFC 5545 folded lines (CRLF followed by space/tab = continuation).
function unfold(ics: string): string[] {
  return ics
    .replace(/\r\n[ \t]/g, "")
    .replace(/\n[ \t]/g, "")
    .split(/\r?\n/);
}

function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

// How far a named IANA zone sits from UTC at a given instant, in ms.
// Returns null for a zone name Intl doesn't recognise.
function zoneOffsetMs(instant: number, timeZone: string): number | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
  } catch {
    return null; // invalid TZID
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const hour = get("hour");
  // Intl can render midnight as hour 24 in some engines; normalise it.
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    hour === 24 ? 0 : hour,
    get("minute"),
    get("second"),
  );
  return Number.isNaN(asUtc) ? null : asUtc - instant;
}

// A naive wall-clock value in `timeZone` → the UTC instant it names.
// Two passes: the first offset guess is wrong only when it lands on the far
// side of a DST transition, and re-reading the offset at the corrected instant
// settles it. Unknown zone → treated as UTC. Ambiguous times (the repeated
// hour when clocks go back) resolve to the first occurrence; nonexistent ones
// (the skipped hour) to the post-jump instant — both are the conventional
// choice and neither can be "right".
function naiveToUtc(naive: number, timeZone: string): number {
  const first = zoneOffsetMs(naive, timeZone);
  if (first === null) return naive;
  const second = zoneOffsetMs(naive - first, timeZone);
  return naive - (second ?? first);
}

interface IcsMoment {
  naive: number; // wall-clock components, as a sortable number
  zone: string; // IANA zone the wall clock belongs to ("UTC" for Z values)
  dateOnly: boolean; // an all-day DATE value
}

// "20260611" / "20260611T090000" / "20260611T090000Z" → wall-clock + zone.
function parseIcsMoment(raw: string, tzid?: string): IcsMoment | null {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) {
    const dt = new Date(raw);
    return Number.isNaN(dt.getTime())
      ? null
      : { naive: dt.getTime(), zone: "UTC", dateOnly: false };
  }
  const [, y, mo, d, h, mi, s, z] = m;
  const naive = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h ?? 0),
    Number(mi ?? 0),
    Number(s ?? 0),
  );
  if (Number.isNaN(naive)) return null;
  // All-day: a calendar date, pinned to UTC midnight so it never drifts.
  if (h === undefined) return { naive, zone: "UTC", dateOnly: true };
  if (z) return { naive, zone: "UTC", dateOnly: false };
  return { naive, zone: tzid || process.env.USER_TIMEZONE || "UTC", dateOnly: false };
}

function momentToUtcMs(m: IcsMoment): number {
  return m.dateOnly ? m.naive : naiveToUtc(m.naive, m.zone);
}

function momentToIso(m: IcsMoment): string {
  return new Date(momentToUtcMs(m)).toISOString();
}

/**
 * "20260611", "20260611T090000", "20260611T090000Z" → ISO string (or null).
 * `tzid` is the IANA zone from the property's TZID parameter, when present.
 */
export function parseIcsDate(raw: string, tzid?: string): string | null {
  const m = parseIcsMoment(raw, tzid);
  return m ? momentToIso(m) : null;
}

// "2026-06-15T09:00:00.000Z" → "20260615T090000Z", the compact form Google
// uses to key an individual occurrence of a recurring event.
function compactUtc(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

// --- raw VEVENT collection -------------------------------------------------

interface RawEvent {
  uid?: string;
  summary?: string;
  location?: string;
  description?: string;
  dtstart?: { raw: string; tzid?: string };
  dtend?: { raw: string; tzid?: string };
  rrule?: string;
  exdates: Array<{ raw: string; tzid?: string }>;
  recurrenceId?: { raw: string; tzid?: string };
}

function parseRawEvents(lines: string[]): RawEvent[] {
  const out: RawEvent[] = [];
  let cur: RawEvent | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) continue;

    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const keyPart = line.slice(0, idx); // e.g. "DTSTART;TZID=Asia/Riyadh"
    const value = line.slice(idx + 1).trim();
    const segments = keyPart.split(";");
    const key = (segments[0] ?? keyPart).toUpperCase();

    // TZID parameter; the quoted form is legal per RFC 5545 §3.2.19.
    const tzParam = segments.slice(1).find((p) => p.toUpperCase().startsWith("TZID="));
    const tzid = tzParam ? tzParam.slice(5).replace(/^"|"$/g, "").trim() || undefined : undefined;

    switch (key) {
      case "UID":
        cur.uid = value;
        break;
      case "SUMMARY":
        cur.summary = value;
        break;
      case "LOCATION":
        cur.location = value;
        break;
      case "DESCRIPTION":
        cur.description = value;
        break;
      case "DTSTART":
        cur.dtstart = { raw: value, tzid };
        break;
      case "DTEND":
        cur.dtend = { raw: value, tzid };
        break;
      case "RRULE":
        cur.rrule = value;
        break;
      case "RECURRENCE-ID":
        cur.recurrenceId = { raw: value, tzid };
        break;
      case "EXDATE":
        // One EXDATE line may carry several comma-separated values.
        for (const v of value.split(",")) {
          const trimmed = v.trim();
          if (trimmed) cur.exdates.push({ raw: trimmed, tzid });
        }
        break;
      default:
        break;
    }
  }
  return out;
}

// --- assembly --------------------------------------------------------------

const DEFAULT_PAST_DAYS = 30;
const DEFAULT_FUTURE_DAYS = 180;

export interface ParseIcsOptions {
  /** Expansion window for recurring events. Defaults to −30d … +180d from now.
   *  Non-recurring events are always returned regardless of this window. */
  from?: Date | number;
  to?: Date | number;
}

function buildEvent(
  raw: RawEvent,
  uid: string,
  externalId: string,
  startIso: string,
  endIso: string | null,
  allDay: boolean,
): IcsEvent {
  return {
    uid,
    externalId,
    title: raw.summary ? unescapeText(raw.summary) : null,
    start: startIso,
    end: endIso,
    location: raw.location ? unescapeText(raw.location) : null,
    description: raw.description ? unescapeText(raw.description).slice(0, 2000) : null,
    allDay,
  };
}

export function parseIcs(ics: string, opts?: ParseIcsOptions): IcsEvent[] {
  const raws = parseRawEvents(unfold(ics));

  const now = Date.now();
  const windowFrom = Number(opts?.from ?? now - DEFAULT_PAST_DAYS * 86_400_000);
  const windowTo = Number(opts?.to ?? now + DEFAULT_FUTURE_DAYS * 86_400_000);

  // A VEVENT carrying RECURRENCE-ID replaces one instance of its series.
  const overrides = new Map<string, RawEvent>();
  const masters: RawEvent[] = [];
  for (const r of raws) {
    if (!r.uid || !r.dtstart) continue; // UID + DTSTART are both mandatory
    if (r.recurrenceId) {
      const at = parseIcsDate(r.recurrenceId.raw, r.recurrenceId.tzid);
      if (at) overrides.set(`${r.uid}|${at}`, r);
    } else {
      masters.push(r);
    }
  }

  const events: IcsEvent[] = [];

  for (const raw of masters) {
    const uid = raw.uid!;
    const startMoment = parseIcsMoment(raw.dtstart!.raw, raw.dtstart!.tzid);
    if (!startMoment) continue;
    const endMoment = raw.dtend ? parseIcsMoment(raw.dtend.raw, raw.dtend.tzid) : null;
    const startIso = momentToIso(startMoment);
    const endIso = endMoment ? momentToIso(endMoment) : null;

    const rule = raw.rrule ? parseRrule(raw.rrule) : null;
    if (!rule) {
      // Not recurring, or a rule this engine won't attempt: the master alone.
      events.push(buildEvent(raw, uid, uid, startIso, endIso, startMoment.dateOnly));
      continue;
    }

    const toUtc = (naive: number) =>
      startMoment.dateOnly ? naive : naiveToUtc(naive, startMoment.zone);

    // Duration is held in wall-clock so an occurrence keeps its local length
    // across a DST change, matching what calendar clients show.
    const durationNaive = endMoment ? endMoment.naive - startMoment.naive : null;

    // UNTIL is an instant (normally Z). Express it in the series' own
    // wall-clock so the boundary lines up with generated occurrences.
    let untilNaive: number | null = null;
    const untilMoment = rule.until ? parseIcsMoment(rule.until) : null;
    if (untilMoment) {
      const untilUtc = momentToUtcMs(untilMoment);
      untilNaive = startMoment.dateOnly
        ? untilUtc
        : untilUtc + (zoneOffsetMs(untilUtc, startMoment.zone) ?? 0);
    }

    const excluded = new Set(
      raw.exdates
        .map((x) => parseIcsDate(x.raw, x.tzid ?? raw.dtstart!.tzid))
        .filter((v): v is string => v !== null),
    );

    const occurrences = expandRrule(rule, startMoment.naive, {
      untilNaive,
      withinWindow: (naive) => {
        const t = toUtc(naive);
        return t >= windowFrom && t <= windowTo;
      },
      pastWindow: (naive) => toUtc(naive) > windowTo,
    });

    for (const naive of occurrences) {
      const occStart = new Date(toUtc(naive)).toISOString();
      if (excluded.has(occStart)) continue;

      const override = overrides.get(`${uid}|${occStart}`);
      if (override) {
        const oStart = parseIcsMoment(override.dtstart!.raw, override.dtstart!.tzid);
        if (!oStart) continue; // a malformed override drops the instance, as intended
        const oEnd = override.dtend
          ? parseIcsMoment(override.dtend.raw, override.dtend.tzid)
          : null;
        events.push(
          buildEvent(
            override,
            uid,
            `${uid}_${compactUtc(occStart)}`,
            momentToIso(oStart),
            oEnd ? momentToIso(oEnd) : null,
            oStart.dateOnly,
          ),
        );
        continue;
      }

      const occEnd =
        durationNaive === null ? null : new Date(toUtc(naive + durationNaive)).toISOString();

      events.push(
        buildEvent(raw, uid, `${uid}_${compactUtc(occStart)}`, occStart, occEnd, startMoment.dateOnly),
      );
    }
  }

  return events;
}

const ICS_MAX_BYTES = 5_000_000;

// Fetch + parse an ICS feed, keeping a sane window around now (-30d … +180d)
// so a decade-old recurring calendar doesn't flood the cache. The same window
// bounds RRULE expansion, so an open-ended weekly meeting yields ~30 rows
// rather than an unbounded series.
export async function fetchIcsEvents(url: string): Promise<IcsEvent[]> {
  const res = await fetch(url, { headers: { accept: "text/calendar, text/plain, */*" } });
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = await res.text();
  if (text.length > ICS_MAX_BYTES) throw new Error("ICS feed too large");
  const now = Date.now();
  const lo = now - DEFAULT_PAST_DAYS * 86_400_000;
  const hi = now + DEFAULT_FUTURE_DAYS * 86_400_000;
  return parseIcs(text, { from: lo, to: hi }).filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= lo && t <= hi;
  });
}
