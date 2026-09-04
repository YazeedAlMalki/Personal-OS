import type { Classified, ExtractedEntity, Kind } from "@/lib/ai/types";

// ── Natural-language date extraction (zero-model) ─────────────────────────────
//
// Parses common date phrases from capture text and returns YYYY-MM-DD, or null.
// Accepts an optional `now` for deterministic unit testing.

const _DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

const _MON_LONG = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december",
];
const _MON_SHORT = [
  "jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec",
];

// Month regex fragment: "jan(uary)?" … "dec(ember)?"
const _MFRAG = _MON_SHORT
  .map((s, i) => `${s}(?:${_MON_LONG[i]!.slice(3)})?`)
  .join("|");

// Format the LOCAL calendar day. Never toISOString() here: dates in this file
// are built at local midnight (_sod), so UTC serialization shifts the day back
// for any timezone east of UTC (e.g. "tomorrow" in Riyadh became yesterday+1).
function _ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function _sod(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function _addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

export function parseDueDate(text: string, now: Date = new Date()): string | null {
  const t = text.toLowerCase().replace(/['']/g, "'");
  const today = _sod(now);

  // ── relative anchors ──────────────────────────────────────────────────────
  if (/\b(today|tonight)\b/.test(t)) return _ymd(today);

  if (/\btomorrow\b/.test(t)) return _ymd(_addDays(today, 1));

  const inDays = t.match(/\bin (\d+) days?\b/);
  if (inDays) return _ymd(_addDays(today, parseInt(inDays[1]!)));

  const inWeeks = t.match(/\bin (\d+) weeks?\b/);
  if (inWeeks) return _ymd(_addDays(today, parseInt(inWeeks[1]!) * 7));

  const inMonths = t.match(/\bin (\d+) months?\b/);
  if (inMonths) {
    const d = new Date(today);
    d.setMonth(d.getMonth() + parseInt(inMonths[1]!));
    return _ymd(d);
  }

  // ── weekday names ─────────────────────────────────────────────────────────
  // "next week" → coming Monday
  if (/\bnext week\b/.test(t)) {
    const delta = (8 - today.getDay()) % 7 || 7;
    return _ymd(_addDays(today, delta));
  }

  // "(next) <weekday>"
  const dayM = t.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
  if (dayM) {
    const target = _DAYS.indexOf(dayM[2]!);
    let delta = (target - today.getDay() + 7) % 7;
    if (delta === 0) delta = 7; // same weekday → next occurrence
    if (dayM[1]) delta += 7;    // "next X" → skip this week's occurrence
    return _ymd(_addDays(today, delta));
  }

  // ── week/month anchors ────────────────────────────────────────────────────
  if (/\b(this week|end of (?:the )?week|eow)\b/.test(t)) {
    const d2f = (5 - today.getDay() + 7) % 7 || 7; // days until Friday
    return _ymd(_addDays(today, d2f));
  }

  if (/\b(this month|end of (?:the )?month|eom)\b/.test(t)) {
    const eom = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return _ymd(eom);
  }

  // ── named-month patterns ──────────────────────────────────────────────────
  // "Jan 15", "January 15th", "jan. 3", "15 Jan", "15th January"
  const re_md = new RegExp(`\\b(${_MFRAG})[.,]?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "i");
  const re_dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${_MFRAG})\\b`, "i");

  let mm = t.match(re_md) ?? t.match(re_dm);
  if (mm) {
    // Determine which group is the month and which is the day.
    // re_md: mm[1]=month mm[2]=day   re_dm: mm[1]=day mm[2]=month
    const firstIsMonth = _MON_SHORT.some((s) => mm![1]!.toLowerCase().startsWith(s));
    const monthStr = firstIsMonth ? mm[1]! : mm[2]!;
    const dayStr   = firstIsMonth ? mm[2]! : mm[1]!;

    const mi = _MON_SHORT.findIndex((s) => monthStr.toLowerCase().startsWith(s));
    const day = parseInt(dayStr);
    if (mi >= 0 && day >= 1 && day <= 31) {
      let year = today.getFullYear();
      const candidate = new Date(year, mi, day);
      if (candidate < today) year++;
      return _ymd(new Date(year, mi, day));
    }
  }

  // ── numeric dates ─────────────────────────────────────────────────────────
  // "12/31", "1/5/2027" (MM/DD or MM/DD/YYYY)
  const slashM = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (slashM) {
    const month = parseInt(slashM[1]!) - 1;
    const day   = parseInt(slashM[2]!);
    let year = slashM[3] ? parseInt(slashM[3]!) : today.getFullYear();
    if (year < 100) year += 2000;
    if (month >= 0 && month < 12 && day >= 1 && day <= 31) {
      const candidate = new Date(year, month, day);
      if (!slashM[3] && candidate < today) return _ymd(new Date(year + 1, month, day));
      return _ymd(candidate);
    }
  }

  return null;
}

// Derive urgency bucket from a due-date string (YYYY-MM-DD).
export function dateUrgency(dateStr: string, now: Date = new Date()): Classified["urgency"] {
  const today = _sod(now);
  // Parse as noon local to avoid DST edge cases
  const d = _sod(new Date(`${dateStr}T12:00:00`));
  const days = Math.round((d.getTime() - today.getTime()) / 86_400_000);
  if (days <= 0)  return "today";
  if (days <= 7)  return "this_week";
  if (days <= 31) return "this_month";
  return "someday";
}

// ── Classifier ────────────────────────────────────────────────────────────────
//
// Deterministic last-resort classifier. Runs with ZERO model — keeps capture
// working fully offline/free (P1). Strong signals get auto-create confidence;
// weak ones land below threshold and route to the review queue (P3).
export function regexClassify(text: string, now: Date = new Date()): Classified {
  const t = text.toLowerCase().trim();
  const has = (re: RegExp) => re.test(t);

  let kind: Kind = "note";
  let strong = false;

  if (has(/\b(decided|decision|chose|going with|we'll go|i'll go with)\b/)) {
    kind = "decision";
    strong = true;
  } else if (has(/\b(risk|might fail|could lose|threat|danger|exposure|liability)\b/)) {
    kind = "risk";
    strong = true;
  } else if (has(/\b(opportunity|deal|lead|prospect|pitch|client interested)\b/)) {
    kind = "opportunity";
    strong = true;
  } else if (has(/\b(read|learn|study|course|book|practice|tutorial)\b/)) {
    kind = "learning";
    strong = true;
  } else if (
    has(/\b(call|email|text|message|buy|finish|send|fix|schedule|book|pay|submit|review|todo|task|remind|follow up|followup)\b/) ||
    has(/^(do|call|email|buy|send|fix|pay|finish|book|schedule) /)
  ) {
    kind = "task";
    strong = true;
  } else if (has(/\b(idea|what if|maybe we could|concept|brainstorm)\b/)) {
    kind = "idea";
    strong = true;
  } else if (has(/\b(felt|feeling|today i|grateful|tired|stressed|anxious|happy|mood|slept)\b/)) {
    kind = "journal";
    strong = true;
  }

  // Keyword-based urgency (explicit beats date-derived).
  let explicitUrgency: Classified["urgency"] | null = null;
  if (has(/\b(today|now|urgent|asap|tonight|right away)\b/)) explicitUrgency = "today";
  else if (has(/\b(someday|eventually|one day|no rush)\b/)) explicitUrgency = "someday";
  else if (has(/\b(this month|by month|end of month)\b/)) explicitUrgency = "this_month";

  // Date extraction — gives a concrete due_date and, when no explicit urgency
  // keyword was found, a more accurate urgency bucket.
  const due_date = parseDueDate(text, now) ?? null;
  const urgency: Classified["urgency"] =
    explicitUrgency ?? (due_date ? dateUrgency(due_date, now) : "this_week");

  const priority: Classified["priority"] =
    urgency === "today" ? "high" : urgency === "someday" ? "low" : "medium";

  return {
    kind,
    title: text.trim().slice(0, 120) || "(untitled)",
    urgency,
    priority,
    due_date,
    confidence: strong ? 0.7 : 0.45, // < 0.6 → review queue
  };
}

// ---- Phase 6: deterministic entity extraction (zero-model fallback) --------
//
// Heuristics, not NLP: capitalized phrases that follow a relational cue
// ("call X", "with Y", "at Z") are proposed as entities. Company-suffix names
// (Acme Inc, Northwind Labs) are typed company. Everything found here is
// LOW/MEDIUM confidence — the pipeline only auto-creates entities at >= 0.6,
// so weak guesses can still match existing graph nodes but never spawn junk.

const COMPANY_SUFFIX =
  /\b(inc|llc|corp|corporation|ltd|gmbh|labs|technologies|systems|ventures|capital|partners|holdings|co)\.?$/i;

const PERSON_CUES =
  /\b(call|email|text|message|meet|met|ping|with|from|ask|tell|thank|intro(?:duced?)?(?:\s+(?:by|to))?)\s+$/i;

const PLACE_CUES = /\b(in|at|to|near)\s+$/i;

const STOPWORDS = new Set([
  "i", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december", "today", "tomorrow", "asap",
  "ok", "okay", "todo", "follow", "up", "the", "a", "an", "q1", "q2", "q3", "q4",
]);

// Cue verbs that often START a sentence directly before a name ("Call Sam…").
const LEAD_CUES = new Set([
  "call", "email", "text", "message", "meet", "ping", "ask", "tell", "thank",
]);

// Proper-noun phrase: 1-4 capitalized words (allowing &, ', -, .).
const PHRASE = /\b([A-Z][\w'&.-]*(?:\s+(?:of|the|&)\s+)?(?:\s?[A-Z][\w'&.-]*){0,3})/g;

export function regexExtractEntities(text: string): ExtractedEntity[] {
  const out: ExtractedEntity[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = PHRASE.exec(text)) !== null) {
    let name = (m[1] ?? "").trim().replace(/[.,;:!?]+$/, "");
    if (!name || name.length < 2) continue;
    if (name.split(/\s+/).every((w) => STOPWORDS.has(w.toLowerCase()))) continue;

    const before = text.slice(Math.max(0, m.index - 24), m.index);
    const atSentenceStart = m.index === 0 || /[.!?\n]\s*$/.test(before);
    let hasPersonCue = PERSON_CUES.test(before);
    const hasPlaceCue = PLACE_CUES.test(before);
    let isCompany = COMPANY_SUFFIX.test(name);

    // A capitalized phrase that merely starts a sentence is usually not a name —
    // unless its first word is itself a cue verb ("Call Sam Rivera" → "Sam Rivera").
    if (atSentenceStart && !isCompany && !hasPersonCue) {
      const words = name.split(/\s+/);
      const first = words[0] ?? "";
      if (words.length > 1 && LEAD_CUES.has(first.toLowerCase())) {
        name = words.slice(1).join(" ");
        hasPersonCue = true;
        isCompany = COMPANY_SUFFIX.test(name);
      } else {
        // Skip just the first word so a name later in the phrase still gets seen.
        PHRASE.lastIndex = m.index + Math.max(1, first.length);
        continue;
      }
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;

    let entity_type: ExtractedEntity["entity_type"] = "person";
    let confidence = 0.45; // below auto-create threshold by default
    if (isCompany) {
      entity_type = "company";
      confidence = 0.7;
    } else if (hasPersonCue) {
      entity_type = "person";
      confidence = 0.65;
    } else if (hasPlaceCue) {
      entity_type = "location";
      confidence = 0.5;
    }

    seen.add(key);
    out.push({ name, entity_type, confidence });
    if (out.length >= 10) break;
  }
  return out;
}
