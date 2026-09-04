import type { SupabaseClient } from "@supabase/supabase-js";
import type { LearningItem } from "@/lib/db/types";
import type { LearningCreate } from "@/lib/security/validation";

export async function listLearningItems(supabase: SupabaseClient): Promise<LearningItem[]> {
  const { data, error } = await supabase
    .from("learning_items")
    .select("*")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as LearningItem[];
}

export async function createLearningItem(
  supabase: SupabaseClient,
  input: LearningCreate,
): Promise<LearningItem> {
  const { data, error } = await supabase.from("learning_items").insert(input).select().single();
  if (error) throw error;
  return data as LearningItem;
}

export async function updateLearningItem(
  supabase: SupabaseClient,
  id: string,
  input: Partial<LearningCreate>,
): Promise<LearningItem> {
  const { data, error } = await supabase
    .from("learning_items")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as LearningItem;
}

export async function deleteLearningItem(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("learning_items").delete().eq("id", id);
  if (error) throw error;
}
