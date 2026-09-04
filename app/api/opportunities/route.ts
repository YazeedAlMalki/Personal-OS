import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { opportunityCreate } from "@/lib/security/validation";
import { listOpportunities, createOpportunity } from "@/lib/domains/opportunities";
import { audit } from "@/lib/security/audit";

export async function GET() {
  const supabase = await createClient();
  try {
    const data = await listOpportunities(supabase);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/opportunities]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = opportunityCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createOpportunity(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "opportunities",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/opportunities]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
