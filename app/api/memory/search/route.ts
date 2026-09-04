import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { memorySearch } from "@/lib/security/validation";
import { searchMemory } from "@/lib/memory";
import { rateLimitResponse } from "@/lib/security/ratelimit";

// POST /api/memory/search — vector search over the caller's memory_chunks (§10).
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const limited = rateLimitResponse(`memory-search:${user.id}`, {
    capacity: 30,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = memorySearch.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const data = await searchMemory(supabase, parsed.data.query, parsed.data.limit ?? 20);
    return NextResponse.json({ data });
  } catch (e) {
    console.error("[POST /api/memory/search]", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
