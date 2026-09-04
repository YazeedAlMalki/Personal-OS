import type { SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity } from "@/lib/db/types";
import type { OpportunityCreate } from "@/lib/security/validation";

export async function listOpportunities(
  supabase: SupabaseClient,
): Promise<Opportunity[]> {
  const { data, error } = await supabase
    .from("opportunities")
    .select("*")
    .order("expected_value", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Opportunity[];
}

export async function createOpportunity(
  supabase: SupabaseClient,
  input: OpportunityCreate,
): Promise<Opportunity> {
  const { data, error } = await supabase
    .from("opportunities")
    .insert(input)
    .select()
    .single();
  if (error) throw error;
  return data as Opportunity;
}

export async function updateOpportunity(
  supabase: SupabaseClient,
  id: string,
  input: Partial<OpportunityCreate>,
): Promise<Opportunity> {
  const { data, error } = await supabase
    .from("opportunities")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Opportunity;
}

export async function deleteOpportunity(
  supabase: SupabaseClient,
  id: string,
): Promise<void> {
  const { error } = await supabase.from("opportunities").delete().eq("id", id);
  if (error) throw error;
}
