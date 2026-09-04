import type { SupabaseClient } from "@supabase/supabase-js";
import type { JournalEntry } from "@/lib/db/types";
import type { JournalCreate } from "@/lib/security/validation";

export async function listJournalEntries(supabase: SupabaseClient): Promise<JournalEntry[]> {
  const { data, error } = await supabase
    .from("journal_entries")
    .select("*")
    .order("entry_date", { ascending: false });
  if (error) throw error;
  return (data ?? []) as JournalEntry[];
}

export async function createJournalEntry(
  supabase: SupabaseClient,
  input: JournalCreate,
): Promise<JournalEntry> {
  const { data, error } = await supabase.from("journal_entries").insert(input).select().single();
  if (error) throw error;
  return data as JournalEntry;
}

export async function updateJournalEntry(
  supabase: SupabaseClient,
  id: string,
  input: Partial<JournalCreate>,
): Promise<JournalEntry> {
  const { data, error } = await supabase
    .from("journal_entries")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as JournalEntry;
}

export async function deleteJournalEntry(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("journal_entries").delete().eq("id", id);
  if (error) throw error;
}
