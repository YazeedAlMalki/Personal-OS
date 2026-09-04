import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { runFinanceSnapshot } from "@/lib/domains/finance-sheet-sync";

// POST /api/cron/finance-snapshot — pulls the configured Google Sheet (§12.6),
// deterministically extracts a net-worth snapshot, and either writes it
// directly (high confidence) or parks a review_queue item (low confidence) —
// same P3 pattern the capture pipeline uses. No-op (503) until
// GOOGLE_SERVICE_ACCOUNT_EMAIL/_KEY + GOOGLE_SHEETS_FINANCE_ID are set.
//
// Auth: Bearer ${CRON_SECRET}. Suggested cadence: daily (Vercel Hobby only
// allows daily schedules — see vercel.json).
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
  const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
  if (!profile?.id) {
    return NextResponse.json({ error: "no user" }, { status: 500 });
  }

  try {
    const result = await runFinanceSnapshot(supabase, profile.id);
    if (result.status === "not_configured") {
      return NextResponse.json(
        { error: "Google Sheets finance ingest not configured", ...result },
        { status: 503 },
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("[POST /api/cron/finance-snapshot]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
