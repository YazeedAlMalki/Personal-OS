import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEntityDetail } from "@/lib/domains/entities";

// GET /api/entities/:id — node + neighbors + mirrored contact + linked
// tasks/opportunities. Powers the graph side panel.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "invalid id" }, { status: 400 });
  }
  const supabase = await createClient();
  try {
    const data = await getEntityDetail(supabase, id);
    if (!data) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[GET /api/entities/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
