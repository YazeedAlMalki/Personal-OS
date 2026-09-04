import type { SupabaseClient } from "@supabase/supabase-js";
import type { Task } from "@/lib/db/types";
import type { TaskCreate, TaskUpdate } from "@/lib/security/validation";

export async function listTasks(
  supabase: SupabaseClient,
  opts: { status?: string } = {},
): Promise<Task[]> {
  let q = supabase
    .from("tasks")
    .select("*")
    .order("priority_score", { ascending: false })
    .order("created_at", { ascending: false });
  if (opts.status === "open") q = q.neq("status", "done");
  else if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as Task[];
}

export async function createTask(
  supabase: SupabaseClient,
  input: TaskCreate,
): Promise<Task> {
  const { data, error } = await supabase.from("tasks").insert(input).select().single();
  if (error) throw error;
  return data as Task;
}

export async function updateTask(
  supabase: SupabaseClient,
  id: string,
  input: TaskUpdate,
): Promise<Task> {
  const patch: Record<string, unknown> = { ...input };
  // Maintain completed_at alongside status transitions.
  if (input.status === "done") patch.completed_at = new Date().toISOString();
  else if (input.status) patch.completed_at = null;

  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as Task;
}

export async function deleteTask(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
