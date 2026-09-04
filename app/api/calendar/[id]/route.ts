import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteEvent } from "@/lib/domains/calendar";
import { audit } from "@/lib/security/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  try {
    await deleteEvent(supabase, id);
    await audit(supabase, {
      action: "delete",
      table_name: "calendar_events_cache",
      record_id: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/calendar/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
