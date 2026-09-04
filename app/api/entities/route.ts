import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { entityCreate } from "@/lib/security/validation";
import { createEntity, listEntities } from "@/lib/domains/entities";
import { audit } from "@/lib/security/audit";
import { ENTITY_TYPES, type EntityType } from "@/lib/ai/types";

// GET /api/entities?type=person — list graph nodes, most important first.
export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const typeParam = searchParams.get("type");
  const type =
    typeParam && (ENTITY_TYPES as readonly string[]).includes(typeParam)
      ? (typeParam as EntityType)
      : undefined;
  try {
    const data = await listEntities(supabase, type);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/entities]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// POST /api/entities — manually create a graph node.
export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = entityCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createEntity(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "entities",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/entities]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
