import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { healthDailyCreate } from "@/lib/security/validation";
import {
  listHealthDaily,
  upsertHealthDaily,
} from "@/lib/domains/health";
import { audit } from "@/lib/security/audit";
import { DAY_MS } from "@/lib/scoring/util";

// GET /api/health?days=14 — list recent health_daily rows.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const days = Math.max(1, Math.min(365, Number(searchParams.get("days") ?? 14)));
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  try {
    const data = await listHealthDaily(supabase, since);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/health]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/health — manual upsert for a given date. Scores are recomputed
// after the write so the dashboard reflects the change immediately.
export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = healthDailyCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await upsertHealthDaily(supabase, {
      ...parsed.data,
      source: parsed.data.source ?? "manual",
    });
    await audit(supabase, {
      action: "insert",
      table_name: "health_daily",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/health]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
