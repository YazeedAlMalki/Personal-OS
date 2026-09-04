import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { healthkitIngest } from "@/lib/security/validation";
import { ingestHealthkit, syncHaeWorkouts } from "@/lib/domains/health";
import { rateLimitResponse } from "@/lib/security/ratelimit";
import { readJsonCapped } from "@/lib/security/http";
import { mapHealthAutoExport, mapHaeWorkouts, type HaeBody } from "@/lib/domains/health-auto-export";

// POST /api/ingest/health-auto-export — adapter for the "Health Auto Export"
// iOS app's REST automation (near-real-time background sync, no app to build).
// Same Bearer secret as /api/ingest/healthkit; translates HAE's
// { data: { metrics, workouts } } into our per-day health_daily upsert. HAE can
// re-post the day repeatedly and split across batches — that's fine: each date
// upserts on (user_id, date) and omitted fields are preserved.

const HAE_MAX_BYTES = 25_000_000; // HAE metric exports can be a few MB.

export async function POST(request: Request) {
  const limited = rateLimitResponse("ingest:hae", { capacity: 30, windowMs: 60_000 });
  if (limited) return limited;

  const secret = process.env.HEALTHKIT_INGEST_SECRET;
  if (!secret || secret === "PASTE_RANDOM_SECRET_HERE") {
    return NextResponse.json({ error: "healthkit ingest not configured" }, { status: 503 });
  }
  const auth = request.headers.get("authorization") ?? request.headers.get("x-healthkit-secret") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!secretEquals(presented, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const read = await readJsonCapped<HaeBody>(request, HAE_MAX_BYTES);
  if (!read.ok) return read.response;
  if (!read.body || typeof read.body !== "object") {
    return NextResponse.json({ error: "invalid body" }, { status: 400 });
  }

  const days = mapHealthAutoExport(read.body);
  const workouts = mapHaeWorkouts(read.body);
  if (days.length === 0 && workouts.length === 0) {
    return NextResponse.json({ ok: true, days: 0, note: "no recognized metrics or workouts in payload" });
  }

  const supabase = createServiceClient();
  const { data: profile } = await supabase.from("profiles").select("id").limit(1).single();
  if (!profile?.id) {
    return NextResponse.json({ error: "no user" }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  for (const day of days) {
    const parsed = healthkitIngest.safeParse({ date: day.date, source: "healthkit", ...day.fields });
    if (!parsed.success) {
      results.push({ date: day.date, error: parsed.error.flatten() });
      continue;
    }
    try {
      const r = await ingestHealthkit(supabase, profile.id, parsed.data);
      results.push({
        date: day.date,
        ok: true,
        fields: Object.keys(day.fields).length,
        recovery_score: r.healthDaily.recovery_score,
        activity_score: r.healthDaily.activity_score,
        nutrition_score: r.healthDaily.nutrition_score,
      });
    } catch (e) {
      console.error("[POST /api/ingest/health-auto-export]", e);
      results.push({ date: day.date, error: (e as Error).message });
    }
  }

  // Workouts last, so the counter re-roll + score recompute run with the
  // day's metrics already upserted. Idempotent across HAE's window re-posts.
  let workoutSummary: Record<string, unknown> | undefined;
  if (workouts.length > 0) {
    try {
      const s = await syncHaeWorkouts(supabase, profile.id, workouts);
      workoutSummary = { mapped: workouts.length, ...s };
    } catch (e) {
      console.error("[POST /api/ingest/health-auto-export] workouts", e);
      workoutSummary = { mapped: workouts.length, error: (e as Error).message };
    }
  }

  return NextResponse.json({
    ok: true,
    days: days.length,
    results,
    ...(workoutSummary ? { workouts: workoutSummary } : {}),
  });
}
