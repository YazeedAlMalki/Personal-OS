import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { relationshipCreate } from "@/lib/security/validation";
import { createRelationship } from "@/lib/domains/entities";
import { audit } from "@/lib/security/audit";

// GET /api/relationships — list graph edges.
export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("entity_relationships")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[GET /api/relationships]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data });
}

// POST /api/relationships — manually create a typed edge.
export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = relationshipCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createRelationship(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "entity_relationships",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/relationships]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
