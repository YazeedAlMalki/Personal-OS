import type { SupabaseClient } from "@supabase/supabase-js";
import type { FinanceSnapshot } from "@/lib/db/types";
import type { FinanceSnapshotCreate } from "@/lib/security/validation";

export async function listFinanceSnapshots(
  supabase: SupabaseClient,
  limit = 90,
): Promise<FinanceSnapshot[]> {
  const { data, error } = await supabase
    .from("finance_snapshots")
    .select("*")
    .order("date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as FinanceSnapshot[];
}

// One snapshot per (user_id, date) — re-submitting a date updates it.
export async function upsertFinanceSnapshot(
  supabase: SupabaseClient,
  input: FinanceSnapshotCreate,
): Promise<FinanceSnapshot> {
  const row = { source: "manual", ...input };
  const { data, error } = await supabase
    .from("finance_snapshots")
    .upsert(row, { onConflict: "user_id,date" })
    .select()
    .single();
  if (error) throw error;
  return data as FinanceSnapshot;
}

export async function updateFinanceSnapshot(
  supabase: SupabaseClient,
  id: string,
  input: Partial<FinanceSnapshotCreate>,
): Promise<FinanceSnapshot> {
  const { data, error } = await supabase
    .from("finance_snapshots")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as FinanceSnapshot;
}

export async function deleteFinanceSnapshot(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("finance_snapshots").delete().eq("id", id);
  if (error) throw error;
}
