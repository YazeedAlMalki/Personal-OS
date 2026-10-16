import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";

// Liveness probe: DB reachable + AIProvider.health() (§10). Public (middleware
// exempts it) so external monitors get a real 200/503 instead of a login
// redirect — which means it must not leak internals: statuses only, no error strings.
export async function GET() {
  let db = false;
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").select("id").limit(1);
    db = !error;
  } catch {
    db = false;
  }

  // AI is optional by design (LLM-optional core) — reported, but only the DB
  // gates overall liveness.
  let ai = false;
  let aiModel = "unconfigured";
  try {
    const h = await getProvider().health();
    ai = h.ok;
    aiModel = h.model;
  } catch {
    ai = false;
  }

  const ok = db;
  return NextResponse.json(
    { ok, db: db ? "ok" : "error", ai: ai ? "ok" : "unavailable", ai_model: aiModel },
    { status: ok ? 200 : 503 },
  );
}
