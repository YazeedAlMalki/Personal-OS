import type { SupabaseClient } from "@supabase/supabase-js";

// Phase 8 — export / backup / restore.
//
// A full export is a single JSON document containing every user-owned row across
// all application tables. Restoring it into an EMPTY project must reproduce every
// row (the spec's Phase 8 "done when": a full export round-trips). Restore is
// tested, not assumed — see tests/unit/export.test.ts.
//
// Ordering matters for restore: tables are listed parent-before-child so foreign
// keys resolve as we insert. Any rows that still fail (self-references, ordering
// edge cases) are retried once in a deferred pass at the end.

// Parent → child order. `exports` is intentionally excluded: it is bookkeeping for
// the export action itself and its storage_path values don't survive a restore.
export const EXPORT_TABLES = [
  "profiles",
  "entities",
  "opportunities",
  "goals",
  "projects",
  "contacts",
  "tasks",
  "decisions",
  "risks",
  "entity_relationships",
  "learning_items",
  "health_daily",
  "workouts",
  "nutrition_logs",
  "finance_snapshots",
  "journal_entries",
  "calendar_events_cache",
  "time_logs",
  "raw_ingestion_events",
  "review_queue",
  "memory_chunks",
  "ai_insights",
  "quadrant_corrections",
  "data_quality_scores",
  "audit_log",
] as const;

export type ExportTable = (typeof EXPORT_TABLES)[number];

export const EXPORT_VERSION = 1 as const;

export interface ExportFile {
  version: typeof EXPORT_VERSION;
  exported_at: string;
  user_id: string;
  row_counts: Record<string, number>;
  tables: Record<string, Record<string, unknown>[]>;
}

type Row = Record<string, unknown>;

const PAGE = 1000;

// Pull every row a user owns, table by table, paginated so large tables don't
// blow the response limit. Pass a service-role client and the owner's user_id.
export async function buildExport(
  supabase: SupabaseClient,
  userId: string,
): Promise<ExportFile> {
  const tables: Record<string, Row[]> = {};
  const row_counts: Record<string, number> = {};

  for (const table of EXPORT_TABLES) {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`export ${table}: ${error.message}`);
      const batch = (data ?? []) as Row[];
      rows.push(...batch);
      if (batch.length < PAGE) break;
    }
    tables[table] = rows;
    row_counts[table] = rows.length;
  }

  return {
    version: EXPORT_VERSION,
    exported_at: new Date().toISOString(),
    user_id: userId,
    row_counts,
    tables,
  };
}

export interface RestoreResult {
  inserted: Record<string, number>;
  total: number;
  deferred_retries: number;
  errors: { table: string; message: string }[];
}

// Insert an ExportFile into the target user's account. Every row's user_id is
// remapped to `targetUserId` so a backup can be restored under a fresh auth user.
// Row ids (UUIDs) are preserved so internal foreign keys stay intact.
export async function restoreExport(
  supabase: SupabaseClient,
  targetUserId: string,
  file: ExportFile,
): Promise<RestoreResult> {
  if (file.version !== EXPORT_VERSION) {
    throw new Error(`unsupported export version: ${file.version}`);
  }

  const inserted: Record<string, number> = {};
  const errors: { table: string; message: string }[] = [];
  const deferred: { table: string; rows: Row[] }[] = [];
  let total = 0;

  for (const table of EXPORT_TABLES) {
    const rows = (file.tables[table] ?? []).map((r) => ({
      ...r,
      user_id: targetUserId,
    }));
    inserted[table] = 0;
    if (rows.length === 0) continue;

    for (let i = 0; i < rows.length; i += PAGE) {
      const chunk = rows.slice(i, i + PAGE);
      const { error } = await supabase.from(table).insert(chunk);
      if (error) {
        // Likely a not-yet-inserted referenced row — retry this chunk after all
        // tables are in. If it still fails, it surfaces as an error.
        deferred.push({ table, rows: chunk });
      } else {
        inserted[table] = (inserted[table] ?? 0) + chunk.length;
        total += chunk.length;
      }
    }
  }

  // One deferred pass — resolves self-references and any ordering edge cases.
  let deferred_retries = 0;
  for (const { table, rows } of deferred) {
    deferred_retries += 1;
    const { error } = await supabase.from(table).insert(rows);
    if (error) {
      errors.push({ table, message: error.message });
    } else {
      inserted[table] = (inserted[table] ?? 0) + rows.length;
      total += rows.length;
    }
  }

  return { inserted, total, deferred_retries, errors };
}

// Sum of row_counts — handy for the `exports` bookkeeping row and tests.
export function totalRows(file: ExportFile): number {
  return Object.values(file.row_counts).reduce((a, b) => a + b, 0);
}
