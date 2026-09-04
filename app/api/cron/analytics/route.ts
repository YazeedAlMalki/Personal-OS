import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { runAnalytics } from "@/lib/analytics/runner";
import { persistInsights, resolveSingleUserId } from "@/lib/chief/persist";

// POST /api/cron/analytics — weekly cross-domain correlations.
// Auth: Bearer ${CRON_SECRET}. Suggested cadence: weekly (Mondays).
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret === "PASTE_RANDOM_SECRET_HERE") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secretEquals(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const uid = await resolveSingleUserId(supabase);
  if (!uid) return NextResponse.json({ error: "no user found" }, { status: 503 });
  const insights = await runAnalytics(supabase, new Date());
  const persisted = await persistInsights(supabase, insights, uid);
  return NextResponse.json({ insights: insights.length, persisted });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
