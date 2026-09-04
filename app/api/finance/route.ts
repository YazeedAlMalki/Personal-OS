import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { financeSnapshotCreate } from "@/lib/security/validation";
import { listFinanceSnapshots, upsertFinanceSnapshot } from "@/lib/domains/finance";
import { audit } from "@/lib/security/audit";

export async function GET() {
  const supabase = await createClient();
  try {
    const data = await listFinanceSnapshots(supabase);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/finance]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = financeSnapshotCreate.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const data = await upsertFinanceSnapshot(supabase, parsed.data);
    await audit(supabase, {
      action: "insert",
      table_name: "finance_snapshots",
      record_id: data.id,
      new_value: data,
    });
    return NextResponse.json({ data }, { status: 201 });
  } catch (e) {
    console.error("[POST /api/finance]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
