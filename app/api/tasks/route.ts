import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { taskCreate } from "@/lib/security/validation";
import { listTasks, createTask } from "@/lib/domains/tasks";
import { audit } from "@/lib/security/audit";

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  try {
    const data = await listTasks(supabase, {
      status: searchParams.get("status") ?? undefined,
    });
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/tasks]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = taskCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await createTask(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "tasks",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/tasks]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
