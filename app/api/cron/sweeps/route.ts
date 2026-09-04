import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { buildSnapshot } from "@/lib/chief/snapshot";
import { runChiefOfStaff } from "@/lib/chief";
import { persistInsights, resolveSingleUserId } from "@/lib/chief/persist";

// POST /api/cron/sweeps — Periodic sweep: re-run the Chief of Staff and
// persist any new insights. Designed for a more frequent schedule (e.g. every
// 4h) than the morning briefing — same logic, just no Telegram message.
//
// Auth: CRON_SECRET in the Authorization header.

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
  const snapshot = await buildSnapshot(supabase, new Date());
  const insights = runChiefOfStaff(snapshot);
  const result = await persistInsights(supabase, insights, uid);

  return NextResponse.json({ insights: insights.length, persisted: result });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
