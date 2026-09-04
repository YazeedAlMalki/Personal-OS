import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { QUALITY_TABLES, scoreRow } from "@/lib/scoring/quality";

// Phase 8 — nightly data-quality sweep. For each user, score recent rows of every
// quality-tracked table and upsert into data_quality_scores (unique on
// user_id, table_name, record_id). Idempotent; quality_score is computed by the DB.

const SAMPLE = 500; // most-recently-touched rows per table

export async function listUsersWithData(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("tasks").select("user_id");
  if (error) throw new Error(`quality listUsers: ${error.message}`);
  return [...new Set((data ?? []).map((r) => (r as { user_id: string }).user_id))];
}

export async function scoreUser(
  supabase: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  let scored = 0;
  for (const table of QUALITY_TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(SAMPLE);
    if (error) continue; // a missing optional table shouldn't abort the whole sweep
    const rows = (data ?? []) as Record<string, unknown>[];
    if (rows.length === 0) continue;

    const upserts = rows
      .filter((r) => typeof r.id === "string")
      .map((r) => {
        const q = scoreRow(table, r, now);
        return {
          user_id: userId,
          table_name: table,
          record_id: r.id as string,
          completeness: q.completeness,
          freshness: q.freshness,
          consistency: q.consistency,
          issues: q.issues,
          scored_at: now.toISOString(),
        };
      });

    for (let i = 0; i < upserts.length; i += 500) {
      const chunk = upserts.slice(i, i + 500);
      const { error: upErr } = await supabase
        .from("data_quality_scores")
        .upsert(chunk, { onConflict: "user_id,table_name,record_id" });
      if (!upErr) scored += chunk.length;
    }
  }
  return scored;
}
