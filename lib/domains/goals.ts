import type { SupabaseClient } from "@supabase/supabase-js";
import type { Goal } from "@/lib/db/types";
import type { GoalCreate } from "@/lib/security/validation";

export async function listGoals(supabase: SupabaseClient): Promise<Goal[]> {
  const { data, error } = await supabase
    .from("goals")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Goal[];
}

export async function createGoal(
  supabase: SupabaseClient,
  input: GoalCreate,
): Promise<Goal> {
  const { data, error } = await supabase.from("goals").insert(input).select().single();
  if (error) throw error;
  return data as Goal;
}

export async function updateGoal(
  supabase: SupabaseClient,
  id: string,
  input: Partial<GoalCreate>,
): Promise<Goal> {
  const { data, error } = await supabase
    .from("goals")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Goal;
}

export async function deleteGoal(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("goals").delete().eq("id", id);
  if (error) throw error;
}
