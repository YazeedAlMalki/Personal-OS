import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { timeLogUpdate } from "@/lib/security/validation";
import { updateTimeLog, deleteTimeLog } from "@/lib/domains/timelogs";
import { audit } from "@/lib/security/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = timeLogUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await updateTimeLog(supabase, id, parsed.data);
    await audit(supabase, {
      action: "update",
      table_name: "time_logs",
      record_id: id,
      new_value: data,
    });
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[PATCH /api/time-logs/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  try {
    await deleteTimeLog(supabase, id);
    await audit(supabase, { action: "delete", table_name: "time_logs", record_id: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/time-logs/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
