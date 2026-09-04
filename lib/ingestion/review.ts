import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "@/lib/security/audit";

export async function listOpenReviews(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("review_queue")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

// Accept → insert the proposed record into its table; reject → just close it.
export async function resolveReview(
  supabase: SupabaseClient,
  id: string,
  action: "accept" | "reject",
): Promise<{ status: string; table?: string; id?: string }> {
  const { data: item, error } = await supabase.from("review_queue").select("*").eq("id", id).single();
  if (error || !item) throw error ?? new Error("review item not found");

  if (action === "reject") {
    await supabase
      .from("review_queue")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("id", id);
    return { status: "rejected" };
  }

  const table = item.proposed_table as string;
  const record = item.proposed_record as Record<string, unknown>;
  const { data: created, error: insErr } = await supabase.from(table).insert(record).select("id").single();
  if (insErr || !created) throw insErr ?? new Error("insert failed");
  const newId = created.id as string;

  await supabase
    .from("review_queue")
    .update({ status: "accepted", resolved_record: record, resolved_at: new Date().toISOString() })
    .eq("id", id);
  if (item.raw_event_id) {
    await supabase
      .from("raw_ingestion_events")
      .update({
        processing_status: "done",
        routed_to: table,
        routed_id: newId,
        processed_at: new Date().toISOString(),
      })
      .eq("id", item.raw_event_id);
  }
  await audit(supabase, { action: "insert", table_name: table, record_id: newId, source: "review" });
  return { status: "accepted", table, id: newId };
}
