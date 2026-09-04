import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// GET /api/insights — list persisted ai_insights rows for the current user.
// Optional filters: ?status=new|seen|acted|dismissed|snoozed
//                   ?severity=low|medium|high|critical|info
//                   ?type=correlation|forecast|<rule id>
//                   ?limit=50 (default 100, max 500)

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const severity = url.searchParams.get("severity");
  const type = url.searchParams.get("type");
  const limitParam = Number(url.searchParams.get("limit") ?? 100);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitParam) ? limitParam : 100));

  const supabase = await createClient();
  let q = supabase
    .from("ai_insights")
    .select(
      "id,insight_type,title,body,severity,status,confidence_score,related_table,related_record_id,snooze_until,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) q = q.eq("status", status);
  if (severity) q = q.eq("severity", severity);
  if (type) q = q.eq("insight_type", type);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}
