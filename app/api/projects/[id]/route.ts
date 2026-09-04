import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { projectUpdate } from "@/lib/security/validation";
import { updateProject, deleteProject } from "@/lib/domains/projects";
import { audit } from "@/lib/security/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = projectUpdate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await updateProject(supabase, id, parsed.data);
    await audit(supabase, {
      action: "update",
      table_name: "projects",
      record_id: id,
      new_value: data,
    });
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[PATCH /api/projects/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params;
  const supabase = await createClient();
  try {
    await deleteProject(supabase, id);
    await audit(supabase, { action: "delete", table_name: "projects", record_id: id });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/projects/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
