import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { resolveReview } from "@/lib/ingestion/review";

const Body = z.object({ action: z.enum(["accept", "reject"]) });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const body = await request.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    return NextResponse.json({ data: await resolveReview(supabase, id, parsed.data.action) });
  } catch (e) {
    console.error("[POST /api/review/:id]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
