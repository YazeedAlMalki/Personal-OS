import type { SupabaseClient } from "@supabase/supabase-js";
import type { Classified } from "@/lib/ai/types";
import { classifyWithFallback } from "@/lib/ai";
import { routeRecord, kindToTable } from "@/lib/ingestion/route";
import { audit } from "@/lib/security/audit";
import { classifyQuadrant, urgencyToPriority, type ScoredResult } from "@/lib/eisenhower";
import { buildScoringContext } from "@/lib/eisenhower/context";
import { linkEntitiesForCapture } from "@/lib/domains/entities";
import { rememberText } from "@/lib/memory";

export const CONFIDENCE_THRESHOLD = 0.6;

export type CaptureResult =
  // `rawId` + `scored` let non-web callers (the Telegram bot) build a rich reply
  // — review/undo buttons need rawId; the task reply shows the Eisenhower result —
  // without re-querying or re-scoring. Web/webhook consumers simply ignore them.
  | { status: "created"; table: string; id: string; rawId: string; classified: Classified; scored?: ScoredResult; via: string }
  | { status: "review"; rawId: string; classified: Classified; via: string }
  | { status: "error"; error: string };

// The capture pipeline (architecture §8). Persist raw FIRST (never lose input, P2),
// classify (provider → regex fallback), confidence-gate (low → review queue, P3),
// else write the structured row and audit it.
export async function runCapturePipeline(opts: {
  text: string;
  source: string;
  supabase: SupabaseClient;
  // REQUIRED when `supabase` is a service-role client (webhooks): service role
  // has no auth.uid(), so user_id column defaults resolve to NULL → NOT NULL
  // violations. RLS-scoped callers can omit it.
  userId?: string;
}): Promise<CaptureResult> {
  const { text, source, supabase } = opts;
  const uid = opts.userId ? { user_id: opts.userId } : {};

  // 1. Persist raw input before any processing.
  const { data: raw, error: rawErr } = await supabase
    .from("raw_ingestion_events")
    .insert({ source, content_type: "text", raw_content: text, processing_status: "processing", ...uid })
    .select("id")
    .single();
  if (rawErr || !raw) return { status: "error", error: rawErr?.message ?? "raw insert failed" };
  const rawId = raw.id as string;

  // 2. Classify (never throws; degrades to regex).
  const { result: classified, via } = await classifyWithFallback(text);

  // 3. Confidence gate → review queue (P3).
  if (classified.confidence < CONFIDENCE_THRESHOLD) {
    await supabase.from("review_queue").insert({
      ...uid,
      raw_event_id: rawId,
      proposed_table: kindToTable(classified.kind),
      proposed_record: routeRecord(classified, text).record,
      reason: "low_confidence",
      confidence: classified.confidence,
    });
    await supabase
      .from("raw_ingestion_events")
      .update({ processing_status: "needs_review", classification: classified })
      .eq("id", rawId);
    return { status: "review", rawId, classified, via };
  }

  // 4. Write the structured record.
  const { table, record } = routeRecord(classified, text);
  const { data: created, error: insErr } = await supabase
    .from(table)
    .insert({ ...record, ...uid })
    .select("id")
    .single();
  if (insErr || !created) {
    await supabase
      .from("raw_ingestion_events")
      .update({ processing_status: "error", error_message: insErr?.message, classification: classified })
      .eq("id", rawId);
    return { status: "error", error: insErr?.message ?? "insert failed" };
  }
  const id = created.id as string;

  // 5. Eisenhower scoring (tasks only). Held in `scored` so the result can be
  // returned to the caller (the Telegram reply shows quadrant + reason) instead
  // of being recomputed.
  let scored: ScoredResult | undefined;
  if (table === "tasks") {
    try {
      const ctx = await buildScoringContext(supabase);
      scored = classifyQuadrant(
        { title: classified.title, due_date: classified.due_date ?? null, priority: classified.priority },
        ctx,
      );
      await supabase.from("tasks").update({
        urgency_score: scored.urgency,
        importance_score: scored.importance,
        quadrant: scored.quadrant,
        quadrant_confidence: scored.confidence,
        quadrant_reason: scored.reason,
        priority: urgencyToPriority(scored.urgency),
        priority_score: scored.urgency,
      }).eq("id", id);
    } catch {
      // Scoring failure must not break the capture pipeline.
    }
  }

  // 6. Graph enrichment (Phase 6): extract entities, record mentions, build
  // co-mention edges, link the record to its contact/company. Best-effort —
  // a failure here must never break the capture.
  try {
    // Pass userId so service-role callers (Telegram/webhook) can persist graph
    // nodes/edges — entities.user_id is NOT NULL default auth.uid(), which is NULL
    // under the service role. RLS callers leave it undefined → default applies.
    await linkEntitiesForCapture(supabase, { text, table, recordId: id, userId: opts.userId });
  } catch {
    // Graph enrichment failure must not break the capture pipeline.
  }

  // 7. Memory spine (§5.2): embed the capture so /api/memory/search and
  // /api/ask can find it. Best-effort — no model just means no chunks.
  await rememberText(supabase, { text, sourceType: table, sourceId: id, userId: opts.userId });

  await supabase
    .from("raw_ingestion_events")
    .update({
      processing_status: "done",
      routed_to: table,
      routed_id: id,
      classification: classified,
      processed_at: new Date().toISOString(),
    })
    .eq("id", rawId);
  // Pass userId explicitly: service-role callers (Telegram/webhook) have no
  // auth.uid(), so without this the audit_log row's owner would be NULL.
  await audit(supabase, { action: "insert", table_name: table, record_id: id, source, user_id: opts.userId });

  return { status: "created", table, id, rawId, classified, scored, via };
}
