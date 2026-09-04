import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/forecast — most recent forecast insights for the current user.
// Read-only; the forecast cron persists these. No model is called here.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50),
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select(
      "id,title,body,severity,status,confidence_score,related_table,related_record_id,created_at",
    )
    .eq("insight_type", "forecast")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
