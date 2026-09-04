import type { SupabaseClient } from "@supabase/supabase-js";
import type { Contact } from "@/lib/db/types";
import type { ContactCreate } from "@/lib/security/validation";

export async function listContacts(supabase: SupabaseClient): Promise<Contact[]> {
  const { data, error } = await supabase
    .from("contacts")
    .select("*")
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Contact[];
}

export async function createContact(
  supabase: SupabaseClient,
  input: ContactCreate,
): Promise<Contact> {
  const { data, error } = await supabase.from("contacts").insert(input).select().single();
  if (error) throw error;
  return data as Contact;
}

export async function updateContact(
  supabase: SupabaseClient,
  id: string,
  input: Partial<ContactCreate>,
): Promise<Contact> {
  const { data, error } = await supabase
    .from("contacts")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Contact;
}

export async function deleteContact(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("contacts").delete().eq("id", id);
  if (error) throw error;
}
