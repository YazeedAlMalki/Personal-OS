import type { SupabaseClient } from "@supabase/supabase-js";
import type { Risk } from "@/lib/db/types";
import type { RiskCreate } from "@/lib/security/validation";

export async function listRisks(supabase: SupabaseClient): Promise<Risk[]> {
  const { data, error } = await supabase
    .from("risks")
    .select("*")
    .order("risk_score", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Risk[];
}

export async function createRisk(
  supabase: SupabaseClient,
  input: RiskCreate,
): Promise<Risk> {
  const { data, error } = await supabase.from("risks").insert(input).select().single();
  if (error) throw error;
  return data as Risk;
}

export async function updateRisk(
  supabase: SupabaseClient,
  id: string,
  input: Partial<RiskCreate>,
): Promise<Risk> {
  const { data, error } = await supabase
    .from("risks")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Risk;
}

export async function deleteRisk(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("risks").delete().eq("id", id);
  if (error) throw error;
}
