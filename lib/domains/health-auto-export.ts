// Pure mapper: Health Auto Export (JSON+CSV app) REST payload -> our per-day
// HealthkitIngest fields. No "server-only" import so it's unit-testable
// (matches the health.ts / ical.ts convention).
//
// HAE posts { "data": { "metrics": [...], "workouts": [...] } }. Each metric is
// { name, units, data: [ { qty, date, source } | sleep object ] }. It re-exports
// the whole configured window on each (best-effort, ~5-min) background run, and
// can split one export across several POSTs (Batch Requests). Because our
// ingestHealthkit upsert preserves fields that aren't sent, partial/overlapping
// posts merge correctly on (user_id, date).

export interface HaeDataPoint {
  qty?: number;
  date?: string;
  source?: string;
  value?: string; // unaggregated sleep segment label
  startDate?: string;
  endDate?: string;
  // aggregated sleep (hours):
  totalSleep?: number;
  asleep?: number;
  core?: number;
  deep?: number;
  rem?: number;
  sleepStart?: string;
  [k: string]: unknown;
}
export interface HaeMetric {
  name?: string;
  units?: string;
  data?: HaeDataPoint[];
}
export interface HaeBody {
  data?: { metrics?: HaeMetric[]; workouts?: HaeWorkout[] };
  metrics?: HaeMetric[];
  workouts?: HaeWorkout[];
}

// HAE workout entries: { name, start, end, ... } where numeric fields are either
// bare numbers or { qty, units } objects depending on app version/settings.
export interface HaeQty {
  qty?: number;
  units?: string;
}
export interface HaeWorkout {
  name?: string;
  start?: string;
  end?: string;
  startDate?: string;
  endDate?: string;
  duration?: number; // seconds in current HAE exports (fallback only — see below)
  distance?: HaeQty | number;
  activeEnergyBurned?: HaeQty | number;
  activeEnergy?: HaeQty | number;
  avgHeartRate?: HaeQty | number;
  averageHeartRate?: HaeQty | number;
  maxHeartRate?: HaeQty | number;
  [k: string]: unknown;
}

export interface MappedFields {
  steps?: number;
  active_energy_burned?: number;
  calories_consumed?: number;
  protein_grams?: number;
  resting_heart_rate?: number;
  hrv?: number;
  vo2_max?: number;
  weight?: number;
  body_fat_percentage?: number;
  sleep_minutes?: number;
}
export interface MappedDay {
  date: string;
  fields: MappedFields;
}

type Agg = "sum" | "latest";
// Exact HAE metric-name strings (from HealthyApps' MetricName.ts) -> our field.
const METRIC_MAP: Record<string, { field: keyof MappedFields; agg: Agg }> = {
  step_count: { field: "steps", agg: "sum" },
  active_energy: { field: "active_energy_burned", agg: "sum" },
  dietary_energy: { field: "calories_consumed", agg: "sum" },
  protein: { field: "protein_grams", agg: "sum" },
  resting_heart_rate: { field: "resting_heart_rate", agg: "latest" },
  heart_rate_variability: { field: "hrv", agg: "latest" },
  vo2max: { field: "vo2_max", agg: "latest" },
  weight_body_mass: { field: "weight", agg: "latest" },
  body_fat_percentage: { field: "body_fat_percentage", agg: "latest" },
  // sleep_analysis handled separately (special shape)
};

const round1 = (n: number) => Math.round(n * 10) / 10;

// "2026-06-21 08:00:00 -0700" | ISO | "2026-06-21" -> "2026-06-21" (local cal day)
function localDate(s?: unknown): string | null {
  if (typeof s !== "string" || s.length < 10) return null;
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

// Best-effort timestamp for "latest" comparisons. Normalizes HAE's
// "yyyy-MM-dd HH:mm:ss Z" and ISO forms; falls back to 0.
function toEpoch(s?: unknown): number {
  if (typeof s !== "string") return 0;
  const v = s
    .trim()
    .replace(" ", "T")
    .replace(/\s+([+-]\d{2})(\d{2})$/, "$1:$2") // " -0700" -> "-07:00"
    .replace(/([+-]\d{2})(\d{2})$/, "$1:$2"); // "+0000" -> "+00:00"
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : 0;
}

function addSleep(p: HaeDataPoint, days: Record<string, MappedFields>) {
  const aggregated =
    typeof p.totalSleep === "number" ||
    typeof p.asleep === "number" ||
    typeof p.deep === "number" ||
    typeof p.rem === "number" ||
    typeof p.core === "number";
  if (aggregated) {
    const d = localDate(p.date ?? p.sleepStart ?? p.startDate);
    if (!d) return;
    const hours =
      typeof p.totalSleep === "number"
        ? p.totalSleep
        : (p.asleep ?? 0) + (p.core ?? 0) + (p.deep ?? 0) + (p.rem ?? 0);
    const day = (days[d] ??= {});
    day.sleep_minutes = (day.sleep_minutes ?? 0) + hours * 60;
    return;
  }
  // unaggregated segment: sum the asleep phases (mutually exclusive)
  const val = String(p.value ?? "").toLowerCase();
  if (["asleep", "core", "rem", "deep"].includes(val)) {
    const d = localDate(p.startDate ?? p.date);
    if (!d) return;
    const hrs = typeof p.qty === "number" ? p.qty : 0;
    const day = (days[d] ??= {});
    day.sleep_minutes = (day.sleep_minutes ?? 0) + hrs * 60;
  }
}

/**
 * Map a Health Auto Export REST payload to one HealthkitIngest-shaped record per
 * local calendar date. Unknown metrics are ignored; units are normalized
 * (kJ->kcal, lb->kg, sleep hours->minutes, body-fat fraction->percent).
 */
export function mapHealthAutoExport(body: HaeBody | null | undefined): MappedDay[] {
  const metrics = body?.data?.metrics ?? body?.metrics ?? [];
  if (!Array.isArray(metrics)) return [];
  const days: Record<string, MappedFields> = {};
  const latestTs: Record<string, number> = {};

  for (const m of metrics) {
    if (!m || typeof m.name !== "string" || !Array.isArray(m.data)) continue;
    if (m.name === "sleep_analysis") {
      for (const p of m.data) if (p) addSleep(p, days);
      continue;
    }
    const spec = METRIC_MAP[m.name];
    if (!spec) continue;
    const units = (m.units ?? "").toLowerCase();
    for (const p of m.data) {
      const d = localDate(p?.date ?? p?.startDate);
      if (!d) continue;
      let q = typeof p?.qty === "number" ? p.qty : NaN;
      if (!Number.isFinite(q)) continue;
      // unit normalization
      if (spec.field === "active_energy_burned" || spec.field === "calories_consumed") {
        if (units.includes("kj")) q = q / 4.184; // kJ -> kcal
      } else if (spec.field === "weight") {
        if (units.includes("lb") || units.includes("pound")) q = q * 0.453592; // lb -> kg
      } else if (spec.field === "body_fat_percentage" && q > 0 && q <= 1) {
        q = q * 100; // fraction -> percent
      }
      const day = (days[d] ??= {});
      if (spec.agg === "sum") {
        day[spec.field] = (day[spec.field] ?? 0) + q;
      } else {
        const key = `${d}|${spec.field}`;
        const ts = toEpoch(p?.date ?? p?.startDate);
        const prev = latestTs[key];
        if (prev === undefined || ts >= prev) {
          latestTs[key] = ts;
          day[spec.field] = q;
        }
      }
    }
  }

  // sensible rounding (counts integer; biometrics 1dp)
  for (const f of Object.values(days)) {
    for (const k of ["steps", "active_energy_burned", "calories_consumed", "protein_grams", "resting_heart_rate", "sleep_minutes"] as const) {
      if (f[k] != null) f[k] = Math.round(f[k] as number);
    }
    for (const k of ["weight", "hrv", "vo2_max", "body_fat_percentage"] as const) {
      if (f[k] != null) f[k] = round1(f[k] as number);
    }
  }

  return Object.entries(days)
    .map(([date, fields]) => ({ date, fields }))
    .filter((x) => Object.keys(x.fields).length > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// Workouts
// ---------------------------------------------------------------------------

// Shaped for a `workouts` table row (distance in METERS, matching workoutCreate).
// `sync_key` is the dedupe identity: HAE re-posts its whole window every few
// minutes, so inserts must be idempotent — the key is stored in `notes` and
// matched on the next post (see syncHaeWorkouts in health.ts).
export interface MappedWorkout {
  date: string;
  workout_type: string | null;
  duration_minutes: number | null;
  calories_burned: number | null;
  distance: number | null;
  average_heart_rate: number | null;
  max_heart_rate: number | null;
  sync_key: string;
}

// Bare number or { qty } -> number | null.
function qtyOf(v: unknown): { qty: number; units: string } | null {
  if (typeof v === "number" && Number.isFinite(v)) return { qty: v, units: "" };
  if (v && typeof v === "object") {
    const o = v as HaeQty;
    if (typeof o.qty === "number" && Number.isFinite(o.qty)) {
      return { qty: o.qty, units: (o.units ?? "").toLowerCase() };
    }
  }
  return null;
}

// Clamp to the same caps as the zod workoutCreate schema; out-of-range readings
// drop the field, never the workout.
function capped(n: number | null, max: number, round: (x: number) => number): number | null {
  if (n == null || !Number.isFinite(n) || n < 0) return null;
  const r = round(n);
  return r > max ? null : r;
}

/**
 * Map HAE's workouts[] to insertable rows. Duration comes from end−start
 * (unambiguous); the bare `duration` number is only a fallback (>1440 ⇒ treated
 * as seconds, else minutes — HAE has shipped both). Energy kJ→kcal, distance
 * km/mi→meters. Entries without a parseable start date are skipped.
 */
export function mapHaeWorkouts(body: HaeBody | null | undefined): MappedWorkout[] {
  const list = body?.data?.workouts ?? body?.workouts ?? [];
  if (!Array.isArray(list)) return [];
  const out: MappedWorkout[] = [];

  for (const w of list) {
    if (!w || typeof w !== "object") continue;
    const start = w.start ?? w.startDate;
    const date = localDate(start);
    if (!date) continue;
    const startEpoch = toEpoch(start);
    const endEpoch = toEpoch(w.end ?? w.endDate);

    let minutes: number | null = null;
    if (startEpoch > 0 && endEpoch > startEpoch) {
      minutes = (endEpoch - startEpoch) / 60_000;
    } else if (typeof w.duration === "number" && Number.isFinite(w.duration) && w.duration > 0) {
      minutes = w.duration > 1440 ? w.duration / 60 : w.duration;
    }

    const energy = qtyOf(w.activeEnergyBurned ?? w.activeEnergy);
    let kcal = energy ? energy.qty : null;
    if (kcal != null && energy?.units.includes("kj")) kcal = kcal / 4.184;

    const dist = qtyOf(w.distance);
    let meters = dist ? dist.qty : null;
    if (meters != null && dist) {
      if (dist.units.includes("mi")) meters = meters * 1609.344;
      else if (dist.units.includes("km") || dist.units === "") meters = meters * 1000; // HAE default is km
      // "m", "meter" -> already meters
    }

    const avg = qtyOf(w.avgHeartRate ?? w.averageHeartRate);
    const max = qtyOf(w.maxHeartRate);

    const type = typeof w.name === "string" && w.name.trim() !== "" ? w.name.trim().slice(0, 100) : null;
    const startIso = startEpoch > 0 ? new Date(startEpoch).toISOString() : `${date}T00:00:00.000Z`;

    out.push({
      date,
      workout_type: type,
      duration_minutes: capped(minutes, 24 * 60, Math.round),
      calories_burned: capped(kcal, 20_000, round1),
      distance: capped(meters, 1_000_000, Math.round),
      average_heart_rate: capped(avg ? avg.qty : null, 250, Math.round),
      max_heart_rate: capped(max ? max.qty : null, 260, Math.round),
      sync_key: `hae:${startIso}${type ? `:${type}` : ""}`,
    });
  }

  return out.sort((a, b) => a.date.localeCompare(b.date) || a.sync_key.localeCompare(b.sync_key));
}
