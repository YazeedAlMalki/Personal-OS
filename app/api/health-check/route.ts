import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getProvider } from "@/lib/ai";

// Liveness probe: DB reachable + AIProvider.health() (§10). Public (middleware
// exempts it) so external monitors get a real 200/503 instead of a login
// redirect — which means it must not leak internals: statuses only, no error strings.
const AI_TIMEOUT_MS = 3_000;

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
  // gates overall liveness. Bounded, so a provider that accepts the connection
  // and never answers can't hang the probe.
  let ai = false;
  let aiModel = "unconfigured";
  try {
    const h = await Promise.race([
      getProvider().health(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("ai health timeout")), AI_TIMEOUT_MS)),
    ]);
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
