import type { SupabaseClient } from "@supabase/supabase-js";
import type { TimeLog } from "@/lib/db/types";
import type { TimeLogCreate } from "@/lib/security/validation";

export async function listTimeLogs(supabase: SupabaseClient): Promise<TimeLog[]> {
  const { data, error } = await supabase
    .from("time_logs")
    .select("*")
    .order("start_time", { ascending: false });
  if (error) throw error;
  return (data ?? []) as TimeLog[];
}

export async function createTimeLog(
  supabase: SupabaseClient,
  input: TimeLogCreate,
): Promise<TimeLog> {
  const { data, error } = await supabase.from("time_logs").insert(input).select().single();
  if (error) throw error;
  return data as TimeLog;
}

export async function updateTimeLog(
  supabase: SupabaseClient,
  id: string,
  input: Partial<TimeLogCreate>,
): Promise<TimeLog> {
  const { data, error } = await supabase
    .from("time_logs")
    .update(input)
    .eq("id", id)
    .select()
    .single();
  if (error) throw error;
  return data as TimeLog;
}

export async function deleteTimeLog(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("time_logs").delete().eq("id", id);
  if (error) throw error;
}
