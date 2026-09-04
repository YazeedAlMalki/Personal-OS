import { NextResponse } from "next/server";
import { secretEquals } from "@/lib/security/secrets";
import { createServiceClient } from "@/lib/supabase/service";
import { listUsersWithEntities, recomputeImportance } from "@/lib/domains/entities";

// POST /api/cron/graph-importance — nightly recompute of entities.importance_score:
//   degree_centrality·50 + linkedOpportunityValue·30 + recentMentions·20
// Idempotent; only rows whose score actually changed are written.
//
// Auth: Bearer ${CRON_SECRET}.
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
  const users = await listUsersWithEntities(supabase);
  let updated = 0;
  for (const uid of users) {
    updated += await recomputeImportance(supabase, uid);
  }
  return NextResponse.json({ users: users.length, entities_rescored: updated });
}

// Vercel Cron invokes cron paths with GET (Authorization header is still sent).
// POST remains for run-cron.sh / manual curl.
export async function GET(request: Request) {
  return POST(request);
}
