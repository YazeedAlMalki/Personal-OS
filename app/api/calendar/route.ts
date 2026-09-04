import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { calendarEventCreate } from "@/lib/security/validation";
import { listEvents, createManualEvent } from "@/lib/domains/calendar";
import { audit } from "@/lib/security/audit";

// GET /api/calendar?from=ISO&to=ISO — cached events (§12.5). POST adds a manual event.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  try {
    const data = await listEvents(supabase, {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/calendar]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = calendarEventCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createManualEvent(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "calendar_events_cache",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/calendar]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
