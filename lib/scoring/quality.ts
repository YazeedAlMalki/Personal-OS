// Phase 8 — data-quality scoring (pure, deterministic; no DB, no model).
//
// Each scored record gets three sub-scores in [0,1]; the DB column quality_score
// is GENERATED as completeness*0.5 + freshness*0.3 + consistency*0.2, so we only
// persist the three inputs + an issues[] list.
//
//   completeness — fraction of a table's "important" fields that are populated.
//   freshness    — exponential decay on age of updated_at (half-life per table).
//   consistency  — fraction of table-specific sanity checks that pass.

export type Row = Record<string, unknown>;

export interface QualityResult {
  completeness: number;
  freshness: number;
  consistency: number;
  issues: string[];
}

type Check = (row: Row) => string | null; // returns an issue string when it FAILS

interface TableConfig {
  importantFields: string[];
  halfLifeDays: number;
  checks: Check[];
}

const present = (v: unknown): boolean =>
  v !== null && v !== undefined && !(typeof v === "string" && v.trim() === "");

const num = (v: unknown): number | null =>
  typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" && !isNaN(Number(v)) ? Number(v) : null;

const inRange = (field: string, lo: number, hi: number): Check => (row) => {
  const n = num(row[field]);
  if (n === null) return null; // absence is a completeness concern, not consistency
  return n < lo || n > hi ? `${field} out of range [${lo}, ${hi}]: ${n}` : null;
};

const CONFIG: Record<string, TableConfig> = {
  tasks: {
    importantFields: ["title", "status", "priority", "due_date"],
    halfLifeDays: 30,
    checks: [
      (r) => (r.status === "done" && !present(r.completed_at) ? "done task missing completed_at" : null),
      (r) => (r.status !== "done" && present(r.completed_at) ? "non-done task has completed_at" : null),
    ],
  },
  goals: {
    importantFields: ["title", "status", "why_it_matters", "next_action", "deadline"],
    halfLifeDays: 60,
    checks: [
      inRange("progress_percentage", 0, 100),
      (r) => (r.status === "active" && !present(r.next_action) ? "active goal has no next_action" : null),
    ],
  },
  projects: {
    importantFields: ["title", "status", "category"],
    halfLifeDays: 45,
    checks: [],
  },
  opportunities: {
    importantFields: ["title", "status", "probability", "value", "next_action"],
    halfLifeDays: 21,
    checks: [
      inRange("probability", 0, 1),
      (r) => {
        const v = num(r.value);
        return v !== null && v < 0 ? `negative value: ${v}` : null;
      },
    ],
  },
  decisions: {
    importantFields: ["title", "status", "rationale"],
    halfLifeDays: 90,
    checks: [inRange("assumption_confidence", 0, 1), inRange("outcome_score", 0, 1)],
  },
  risks: {
    importantFields: ["title", "status", "likelihood", "impact", "mitigation"],
    halfLifeDays: 30,
    checks: [inRange("likelihood", 0, 1), inRange("impact", 0, 1)],
  },
  contacts: {
    importantFields: ["name", "category"],
    halfLifeDays: 120,
    checks: [],
  },
  health_daily: {
    importantFields: ["date", "sleep_hours", "steps", "resting_heart_rate"],
    halfLifeDays: 14,
    checks: [
      inRange("sleep_hours", 0, 24),
      inRange("resting_heart_rate", 25, 220),
      (r) => {
        const s = num(r.steps);
        return s !== null && s < 0 ? `negative steps: ${s}` : null;
      },
    ],
  },
  finance_snapshots: {
    importantFields: ["date", "net_worth"],
    halfLifeDays: 45,
    checks: [],
  },
  journal_entries: {
    importantFields: ["content", "entry_date"],
    halfLifeDays: 30,
    checks: [],
  },
  learning_items: {
    importantFields: ["title", "status", "category"],
    halfLifeDays: 60,
    checks: [],
  },
};

export const QUALITY_TABLES = Object.keys(CONFIG);

function completenessOf(cfg: TableConfig, row: Row): number {
  if (cfg.importantFields.length === 0) return 1;
  const filled = cfg.importantFields.filter((f) => present(row[f])).length;
  return round3(filled / cfg.importantFields.length);
}

function freshnessOf(cfg: TableConfig, row: Row, now: Date): number {
  const ts = (row.updated_at ?? row.created_at ?? row.scored_at) as string | undefined;
  if (!ts) return 0;
  const ageMs = now.getTime() - new Date(ts).getTime();
  if (!isFinite(ageMs)) return 0;
  const ageDays = Math.max(0, ageMs / 86_400_000);
  return round3(Math.pow(0.5, ageDays / cfg.halfLifeDays));
}

function consistencyOf(cfg: TableConfig, row: Row): { score: number; issues: string[] } {
  if (cfg.checks.length === 0) return { score: 1, issues: [] };
  const issues: string[] = [];
  for (const check of cfg.checks) {
    const issue = check(row);
    if (issue) issues.push(issue);
  }
  const passed = cfg.checks.length - issues.length;
  return { score: round3(passed / cfg.checks.length), issues };
}

// Score one row of a known table. Unknown tables score as perfect (nothing to check).
export function scoreRow(table: string, row: Row, now: Date = new Date()): QualityResult {
  const cfg = CONFIG[table];
  if (!cfg) return { completeness: 1, freshness: 1, consistency: 1, issues: [] };
  const completeness = completenessOf(cfg, row);
  const freshness = freshnessOf(cfg, row, now);
  const { score: consistency, issues } = consistencyOf(cfg, row);
  return { completeness, freshness, consistency, issues };
}

// Mirror of the DB generated column, for tests and previews.
export function qualityScore(r: QualityResult): number {
  return round3(r.completeness * 0.5 + r.freshness * 0.3 + r.consistency * 0.2);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
