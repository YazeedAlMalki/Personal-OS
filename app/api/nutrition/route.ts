import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { nutritionCreate } from "@/lib/security/validation";
import { createNutritionLog, listNutrition } from "@/lib/domains/health";
import { audit } from "@/lib/security/audit";
import { DAY_MS } from "@/lib/scoring/util";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const days = Math.max(1, Math.min(365, Number(searchParams.get("days") ?? 14)));
  const since = new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);
  try {
    const data = await listNutrition(supabase, since);
    return NextResponse.json({ data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = nutritionCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createNutritionLog(supabase, {
      ...parsed.data,
      source: parsed.data.source ?? "manual",
    });
    await audit(supabase, {
      action: "insert",
      table_name: "nutrition_logs",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
