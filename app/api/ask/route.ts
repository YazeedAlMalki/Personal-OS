import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askQuery } from "@/lib/security/validation";
import { searchMemory } from "@/lib/memory";
import { getProvider } from "@/lib/ai";
import { audit } from "@/lib/security/audit";
import { rateLimitResponse } from "@/lib/security/ratelimit";

// POST /api/ask — RAG Q&A over the user's memory (§10). THE ONLY read path that
// calls a model, and only on explicit user action (cost guard). Deterministic
// core never depends on this route.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Model calls cost money/compute — tighter bucket than plain CRUD.
  const limited = rateLimitResponse(`ask:${user.id}`, { capacity: 10, windowMs: 60_000 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = askQuery.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { question } = parsed.data;

  // 1. Retrieve. No embeddings/model → honest 503, not a hallucinated answer.
  let hits;
  try {
    hits = await searchMemory(supabase, question, 12);
  } catch (e) {
    return NextResponse.json(
      { error: `memory search unavailable: ${(e as Error).message}` },
      { status: 503 },
    );
  }

  if (hits.length === 0) {
    return NextResponse.json({
      data: {
        answer:
          "Nothing in memory matches that yet. Capture some notes first — everything you capture becomes searchable.",
        sources: [],
      },
    });
  }

  // 2. Answer from context.
  const context = hits
    .map((h, i) => `[${i + 1}] (${h.source_type}, ${h.created_at.slice(0, 10)}) ${h.text}`)
    .join("\n");
  try {
    const answer = await getProvider().answer(question, context);
    await audit(supabase, {
      action: "insert",
      table_name: "ask_queries",
      new_value: { question: question.slice(0, 200), sources: hits.length },
      source: "ask",
    });
    return NextResponse.json({
      data: {
        answer,
        sources: hits.map((h) => ({
          source_type: h.source_type,
          source_id: h.source_id,
          text: h.text.slice(0, 160),
          similarity: Math.round(h.similarity * 100) / 100,
          created_at: h.created_at,
        })),
      },
    });
  } catch (e) {
    console.error("[POST /api/ask]", e);
    return NextResponse.json(
      { error: `model unavailable: ${(e as Error).message}` },
      { status: 503 },
    );
  }
}
