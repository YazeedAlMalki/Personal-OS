import type { SupabaseClient } from "@supabase/supabase-js";
import type { CalendarEvent } from "@/lib/db/types";
import type { CalendarEventCreate } from "@/lib/security/validation";
import type { IcsEvent } from "@/lib/integrations/ical";

export async function listEvents(
  supabase: SupabaseClient,
  opts?: { from?: string; to?: string; limit?: number },
): Promise<CalendarEvent[]> {
  let q = supabase
    .from("calendar_events_cache")
    .select("*")
    .order("start_time", { ascending: true })
    .limit(opts?.limit ?? 200);
  if (opts?.from) q = q.gte("start_time", opts.from);
  if (opts?.to) q = q.lte("start_time", opts.to);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as CalendarEvent[];
}

export async function createManualEvent(
  supabase: SupabaseClient,
  input: CalendarEventCreate,
): Promise<CalendarEvent> {
  const { data, error } = await supabase
    .from("calendar_events_cache")
    .insert({ ...input, source: "manual" })
    .select()
    .single();
  if (error) throw error;
  return data as CalendarEvent;
}

export async function deleteEvent(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("calendar_events_cache").delete().eq("id", id);
  if (error) throw error;
}

// Idempotent: upsert on (user_id, source, external_event_id). RLS-scoped client →
// user_id fills from the column default (auth.uid()). Service-role callers (the
// cron) have no auth.uid(), so they pass userId explicitly.
export async function upsertIcsEvents(
  supabase: SupabaseClient,
  events: IcsEvent[],
  userId?: string,
): Promise<number> {
  if (events.length === 0) return 0;
  const rows = events.map((e) => ({
    // externalId, not uid: a recurring series expands to many events that all
    // share one uid, so the occurrence-qualified id is what keeps the
    // (user_id, source, external_event_id) upsert key unique.
    external_event_id: e.externalId,
    title: e.title,
    start_time: e.start,
    end_time: e.end,
    location: e.location,
    description: e.description,
    source: "ics",
    ...(userId ? { user_id: userId } : {}),
  }));
  const { error, count } = await supabase
    .from("calendar_events_cache")
    .upsert(rows, { onConflict: "user_id,source,external_event_id", count: "exact" });
  if (error) throw error;
  return count ?? rows.length;
}
