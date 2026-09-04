import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import {
  listUsersWithHealthData,
  recomputeRecentScores,
} from "@/lib/domains/health";

// POST /api/cron/health-scores — nightly recompute of recovery/activity/nutrition
// scores. Idempotent. Each user's last 7 days are re-scored so freshly-uploaded
// HealthKit data and updated nutrition logs get reflected.
//
// Auth: Bearer ${CRON_SECRET}. Suggested cadence: nightly (e.g. 02:00 user-local).
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
  const users = await listUsersWithHealthData(supabase, 7);
  let total = 0;
  for (const uid of users) {
    total += await recomputeRecentScores(supabase, 7, uid);
  }
  return NextResponse.json({ users: users.length, days_rescored: total });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
