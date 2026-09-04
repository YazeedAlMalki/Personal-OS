import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/analytics/correlations — most recent correlation insights.
// Read-only; the analytics cron persists these. No model is called here.

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(
    100,
    Math.max(1, Number(url.searchParams.get("limit") ?? 30) || 30),
  );

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ai_insights")
    .select("id,title,body,severity,confidence_score,created_at")
    .eq("insight_type", "correlation")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
