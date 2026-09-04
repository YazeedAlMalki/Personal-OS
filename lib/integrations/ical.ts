// §12.5 read-only calendar — minimal ICS (RFC 5545) parser, no deps.
// NOTE: no `import "server-only"` so vitest can import the pure parser
// (same convention as lib/domains/export.ts and health.ts). It still only
// runs server-side — the sole importer is the calendar sync route.
// Works with the private ICS URLs Google Calendar / Outlook / iCloud expose.
// Deliberately small: VEVENT → {uid,title,start,end,location,description}.
// DTSTART formats handled: YYYYMMDD (all-day), YYYYMMDDTHHMMSS, ...Z (UTC),
// and TZID-tagged local times (treated as wall-clock — good enough for a
// read-only "what's on today" cache; full VTIMEZONE handling is out of scope).

export interface IcsEvent {
  uid: string;
  title: string | null;
  start: string; // ISO timestamptz
  end: string | null;
  location: string | null;
  description: string | null;
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

// "20260611", "20260611T090000", "20260611T090000Z" → ISO string (or null).
export function parseIcsDate(raw: string): string | null {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
  if (!m) {
    const dt = new Date(raw);
    return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }
  const [, y, mo, d, h = "00", mi = "00", s = "00", z] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}${z ? "Z" : ""}`;
  const dt = new Date(z ? iso : iso + "Z"); // non-Z treated as wall-clock ≈ UTC
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

export function parseIcs(ics: string): IcsEvent[] {
  const lines = unfold(ics);
  const events: IcsEvent[] = [];
  let cur: Partial<Record<string, string>> | null = null;

  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.UID && cur.DTSTART) {
        const start = parseIcsDate(cur.DTSTART);
        if (start) {
          events.push({
            uid: cur.UID,
            title: cur.SUMMARY ? unescapeText(cur.SUMMARY) : null,
            start,
            end: cur.DTEND ? parseIcsDate(cur.DTEND) : null,
            location: cur.LOCATION ? unescapeText(cur.LOCATION) : null,
            description: cur.DESCRIPTION ? unescapeText(cur.DESCRIPTION).slice(0, 2000) : null,
          });
        }
      }
      cur = null;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const keyPart = line.slice(0, idx); // e.g. "DTSTART;TZID=Europe/Riyadh"
    const key = (keyPart.split(";")[0] ?? keyPart).toUpperCase();
    if (["UID", "SUMMARY", "DTSTART", "DTEND", "LOCATION", "DESCRIPTION"].includes(key)) {
      cur[key] = line.slice(idx + 1).trim();
    }
  }
  return events;
}

const ICS_MAX_BYTES = 5_000_000;

// Fetch + parse an ICS feed, keeping a sane window around now (-30d … +180d)
// so a decade-old recurring calendar doesn't flood the cache.
export async function fetchIcsEvents(url: string): Promise<IcsEvent[]> {
  const res = await fetch(url, { headers: { accept: "text/calendar, text/plain, */*" } });
  if (!res.ok) throw new Error(`ICS fetch failed: ${res.status}`);
  const text = await res.text();
  if (text.length > ICS_MAX_BYTES) throw new Error("ICS feed too large");
  const now = Date.now();
  const lo = now - 30 * 86_400_000;
  const hi = now + 180 * 86_400_000;
  return parseIcs(text).filter((e) => {
    const t = new Date(e.start).getTime();
    return t >= lo && t <= hi;
  });
}
