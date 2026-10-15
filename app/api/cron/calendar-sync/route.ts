import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchIcsEvents } from "@/lib/integrations/ical";
import { upsertIcsEvents } from "@/lib/domains/calendar";
import { audit } from "@/lib/security/audit";

// POST /api/cron/calendar-sync — pulls the read-only ICS feed (§12.5) into the
// calendar cache on a schedule, so /calendar and the daily briefing see current
// events without anyone pressing the Sync button. Idempotent: upserts on
// (user_id, source, external_event_id), same as the session-authed
// POST /api/calendar/sync it mirrors.
//
// No-op (503) until CALENDAR_ICS_URL (or GOOGLE_CALENDAR_ICAL_URL) is set, so
// this is safe to deploy ahead of the URL being configured.
//
// Auth: Bearer ${CRON_SECRET}. Cadence: daily, an hour ahead of the briefing
// cron (Vercel Hobby only allows daily schedules — see vercel.json).
export async function POST(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || cronSecret === "PASTE_RANDOM_SECRET_HERE") {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization") ?? "";
  if (!secretEquals(authHeader, `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.CALENDAR_ICS_URL ?? process.env.GOOGLE_CALENDAR_ICAL_URL;
  if (!url) {
    return NextResponse.json(
      {
        status: "not_configured",
        error:
          "CALENDAR_ICS_URL not configured — paste your calendar's private ICS URL into .env.local and Vercel",
      },
      { status: 503 },
    );
  }

  const supabase = createServiceClient();
  const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
  if (!profile?.id) {
    return NextResponse.json({ error: "no user" }, { status: 500 });
  }

  try {
    const events = await fetchIcsEvents(url);
    const upserted = await upsertIcsEvents(supabase, events, profile.id);
    await audit(supabase, {
      action: "import",
      table_name: "calendar_events_cache",
      new_value: { upserted },
      source: "ics",
      user_id: profile.id,
    });
    return NextResponse.json({ ok: true, events: events.length, upserted });
  } catch (e) {
    console.error("[POST /api/cron/calendar-sync]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
