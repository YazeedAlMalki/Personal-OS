import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { loadDemo, clearDemo } from "@/lib/demo/fixtures";
import { audit } from "@/lib/security/audit";

// Phase 8 — demo mode. POST loads tagged fixtures, DELETE removes them.
// Runs as the signed-in user (RLS applies), so demo rows are owned rows.

export async function POST() {
  const supabase = await createClient();
  try {
    await loadDemo(supabase);
    await audit(supabase, { action: "insert", table_name: "demo_fixtures" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[POST /api/settings/demo]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE() {
  const supabase = await createClient();
  try {
    await clearDemo(supabase);
    await audit(supabase, { action: "delete", table_name: "demo_fixtures" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/settings/demo]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
