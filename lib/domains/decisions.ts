import type { SupabaseClient } from "@supabase/supabase-js";
import type { Decision } from "@/lib/db/types";
import type { DecisionCreate } from "@/lib/security/validation";

export async function listDecisions(supabase: SupabaseClient): Promise<Decision[]> {
  const { data, error } = await supabase
    .from("decisions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Decision[];
}

export async function createDecision(
  supabase: SupabaseClient,
  input: DecisionCreate,
): Promise<Decision> {
  const { data, error } = await supabase.from("decisions").insert(input).select().single();
  if (error) throw error;
  return data as Decision;
}

export async function updateDecision(
  supabase: SupabaseClient,
  id: string,
  input: Partial<DecisionCreate>,
): Promise<Decision> {
  const { data, error } = await supabase
    .from("decisions")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Decision;
}

export async function deleteDecision(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("decisions").delete().eq("id", id);
  if (error) throw error;
}
