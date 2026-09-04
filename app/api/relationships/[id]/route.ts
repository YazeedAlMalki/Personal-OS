import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { relationshipUpdate } from "@/lib/security/validation";
import { updateRelationship, deleteRelationship } from "@/lib/domains/entities";
import { audit } from "@/lib/security/audit";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/relationships/:id — edit a graph edge's type/strength/notes.
// Endpoints (source/target) are immutable here; delete + recreate to rewire.
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = relationshipUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await updateRelationship(supabase, id, parsed.data);
    await audit(supabase, {
      action: "update",
      table_name: "entity_relationships",
      record_id: id,
      new_value: data,
    });
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[PATCH /api/relationships/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

// DELETE /api/relationships/:id — remove a graph edge.
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  try {
    await deleteRelationship(supabase, id);
    await audit(supabase, { action: "delete", table_name: "entity_relationships", record_id: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/relationships/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
