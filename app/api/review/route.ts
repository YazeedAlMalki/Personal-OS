import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listOpenReviews } from "@/lib/ingestion/review";

export async function GET() {
  const supabase = await createClient();
  try {
    return NextResponse.json({ data: await listOpenReviews(supabase) });
  } catch (e) {
    console.error("[GET /api/review]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
