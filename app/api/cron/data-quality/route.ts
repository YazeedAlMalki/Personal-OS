import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { listUsersWithData, scoreUser } from "@/lib/scoring/quality-runner";

// POST /api/cron/data-quality — nightly data-quality sweep across all tracked
// tables. Writes data_quality_scores (idempotent upsert). Auth: Bearer ${CRON_SECRET}.
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
  const users = await listUsersWithData(supabase);
  let total = 0;
  for (const uid of users) {
    total += await scoreUser(supabase, uid);
  }
  return NextResponse.json({ users: users.length, records_scored: total });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
