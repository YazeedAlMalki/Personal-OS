import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { healthkitIngest } from "@/lib/security/validation";
import { ingestHealthkit } from "@/lib/domains/health";
import { rateLimitResponse } from "@/lib/security/ratelimit";
import { readJsonCapped, INGRESS_MAX_BYTES } from "@/lib/security/http";

// POST /api/ingest/healthkit — single endpoint for both Option A (Swift HealthKit
// app) and Option B (Apple Shortcuts). Idempotent upsert on (user_id, date).
//
// Auth: a shared bearer token, HEALTHKIT_INGEST_SECRET. The endpoint runs as
// SERVICE ROLE because the iPhone has no Supabase session; the secret is the
// gate, sender identity is resolved to TELEGRAM_USER_ID's profile (single-user
// install) for now. Multi-user requires a per-device token in a follow-up.

export async function POST(request: Request) {
  // Public (secret-gated) endpoint: rate-limit before the secret check so the
  // limiter also throttles brute-force attempts against the token.
  const limited = rateLimitResponse("ingest:healthkit", {
    capacity: 30,
    windowMs: 60_000,
  });
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

  const read = await readJsonCapped(request, INGRESS_MAX_BYTES);
  if (!read.ok) return read.response;
  const parsed = healthkitIngest.safeParse(read.body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Resolve the target user. Single-user install: take the first profile.
  // Future: an explicit `device_id → user_id` table.
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .limit(1)
    .single();
  if (!profile?.id) {
    return NextResponse.json({ error: "no user" }, { status: 500 });
  }

  try {
    const result = await ingestHealthkit(supabase, profile.id, parsed.data);
    return NextResponse.json({
      ok: true,
      date: result.healthDaily.date,
      workouts_inserted: result.workoutsInserted,
      recovery_score: result.healthDaily.recovery_score,
      activity_score: result.healthDaily.activity_score,
      nutrition_score: result.healthDaily.nutrition_score,
    });
  } catch (e) {
    console.error("[POST /api/ingest/healthkit]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
