import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchIcsEvents } from "@/lib/integrations/ical";
import { upsertIcsEvents } from "@/lib/domains/calendar";
import { audit } from "@/lib/security/audit";
import { rateLimitResponse } from "@/lib/security/ratelimit";

// POST /api/calendar/sync — pull the read-only ICS feed (§12.5) into the cache.
// Session-authed (middleware) + RLS-scoped, so events land under the caller.
// Env-gated: no CALENDAR_ICS_URL → 503 with a setup hint.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = rateLimitResponse(`calendar-sync:${user.id}`, {
    capacity: 6,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const url = process.env.CALENDAR_ICS_URL ?? process.env.GOOGLE_CALENDAR_ICAL_URL;
  if (!url) {
    return NextResponse.json(
      { error: "CALENDAR_ICS_URL not configured — paste your calendar's private ICS URL into .env.local" },
      { status: 503 },
    );
  }

  try {
    const events = await fetchIcsEvents(url);
    const upserted = await upsertIcsEvents(supabase, events);
    await audit(supabase, {
      action: "import",
      table_name: "calendar_events_cache",
      new_value: { upserted },
      source: "ics",
    });
    return NextResponse.json({ ok: true, events: events.length, upserted });
  } catch (e) {
    console.error("[POST /api/calendar/sync]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
