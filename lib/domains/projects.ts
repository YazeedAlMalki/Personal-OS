import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project } from "@/lib/db/types";
import type { ProjectCreate } from "@/lib/security/validation";

export async function listProjects(supabase: SupabaseClient): Promise<Project[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Project[];
}

export async function createProject(
  supabase: SupabaseClient,
  input: ProjectCreate,
): Promise<Project> {
  const { data, error } = await supabase.from("projects").insert(input).select().single();
  if (error) throw error;
  return data as Project;
}

export async function updateProject(
  supabase: SupabaseClient,
  id: string,
  input: Partial<ProjectCreate>,
): Promise<Project> {
  const { data, error } = await supabase
    .from("projects")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Project;
}

export async function deleteProject(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("projects").delete().eq("id", id);
  if (error) throw error;
}
