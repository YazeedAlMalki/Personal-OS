import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { goalCreate } from "@/lib/security/validation";
import { listGoals, createGoal } from "@/lib/domains/goals";
import { audit } from "@/lib/security/audit";

export async function GET() {
  const supabase = await createClient();
  try {
    const data = await listGoals(supabase);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/goals]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = goalCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createGoal(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "goals",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/goals]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
