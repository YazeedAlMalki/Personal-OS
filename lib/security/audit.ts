import type { SupabaseClient } from "@supabase/supabase-js";

// Append an audit_log row. user_id is filled by the column default (auth.uid()).
// Best-effort: a failed audit write must never break the user's actual operation.
export async function audit(
  supabase: SupabaseClient,
  entry: {
    action: "insert" | "update" | "delete" | "export" | "import" | "login";
    table_name: string;
    record_id?: string | null;
    old_value?: unknown;
    new_value?: unknown;
    source?: string;
    // Optional: set the owner explicitly for service-role callers (no auth.uid()).
    // Omitted → the column default (auth.uid()) fills it for RLS-scoped callers.
    user_id?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from("audit_log").insert({
    action: entry.action,
    table_name: entry.table_name,
    record_id: entry.record_id ?? null,
    old_value: entry.old_value ?? null,
    new_value: entry.new_value ?? null,
    source: entry.source ?? "web",
    ...(entry.user_id ? { user_id: entry.user_id } : {}),
  });
  if (error) console.error("[audit] failed:", error.message);
}
