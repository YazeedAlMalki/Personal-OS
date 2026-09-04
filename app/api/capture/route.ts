import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { runCapturePipeline } from "@/lib/ingestion/pipeline";
import { rateLimitResponse } from "@/lib/security/ratelimit";

const Body = z.object({ text: z.string().min(1).max(5000) });

// Web quick-capture (Command Center). Runs the same pipeline the Telegram bot will use.
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Guardrail: 60 captures/min/user.
  const limited = rateLimitResponse(`capture:${user.id}`, { capacity: 60, windowMs: 60_000 });
  if (limited) return limited;

  const body = await request.json().catch(() => null);
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await runCapturePipeline({ text: parsed.data.text, source: "web", supabase });
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 201 });
}
