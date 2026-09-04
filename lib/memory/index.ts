import type { SupabaseClient } from "@supabase/supabase-js";
import { embedSafe, getProvider } from "@/lib/ai";

// §5.2 memory spine + §10 memory routes. Everything captured becomes searchable:
// chunks of source text + 768-d embeddings in memory_chunks, queried through the
// RLS-scoped match_memory_chunks RPC (migration 0010).
//
// Embedding is BEST-EFFORT by design: no model → no chunks → search/ask simply
// report no memory. Capture correctness never depends on it (P1).

const CHUNK_CHARS = 700;
const MAX_CHUNKS_PER_SOURCE = 6;

// Sentence-ish chunking: pack sentences up to ~CHUNK_CHARS, hard-split monsters.
export function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_CHARS) return [clean];

  const sentences = clean.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let cur = "";
  for (const sent of sentences) {
    if (cur && cur.length + sent.length + 1 > CHUNK_CHARS) {
      chunks.push(cur);
      cur = "";
    }
    if (sent.length > CHUNK_CHARS) {
      for (let i = 0; i < sent.length; i += CHUNK_CHARS) {
        chunks.push(sent.slice(i, i + CHUNK_CHARS));
      }
      continue;
    }
    cur = cur ? `${cur} ${sent}` : sent;
  }
  if (cur) chunks.push(cur);
  return chunks.slice(0, MAX_CHUNKS_PER_SOURCE);
}

// Embed + store. Returns chunks written (0 when no embedding model is available).
// Never throws. user_id: omitted under an RLS client (column default auth.uid());
// service-role callers must pass it explicitly.
export async function rememberText(
  supabase: SupabaseClient,
  opts: { text: string; sourceType: string; sourceId: string | null; userId?: string },
): Promise<number> {
  try {
    const chunks = chunkText(opts.text);
    if (chunks.length === 0) return 0;
    const vectors = await embedSafe(chunks);
    if (!vectors) return 0;

    const model = getProvider().name;
    const rows = chunks.map((text, i) => ({
      source_type: opts.sourceType,
      source_id: opts.sourceId,
      text,
      embedding: vectors[i],
      embedding_model: model,
      ...(opts.userId ? { user_id: opts.userId } : {}),
    }));
    const { error } = await supabase.from("memory_chunks").insert(rows);
    if (error) {
      console.error("[memory] insert failed:", error.message);
      return 0;
    }
    return rows.length;
  } catch (e) {
    console.error("[memory] remember failed:", e);
    return 0;
  }
}

export interface MemoryHit {
  id: string;
  source_type: string;
  source_id: string | null;
  text: string;
  similarity: number;
  created_at: string;
}

// Vector search through the user-scoped RPC. Throws when no embedding model is
// reachable — callers surface that as "memory search unavailable".
// Pass userId for service-role callers (Telegram bot, crons) — the default RPC
// uses auth.uid() which is NULL under service role, returning empty results.
export async function searchMemory(
  supabase: SupabaseClient,
  query: string,
  limit = 20,
  userId?: string,
): Promise<MemoryHit[]> {
  const vectors = await embedSafe([query]);
  if (!vectors || !vectors[0]?.length) {
    throw new Error("no embedding model available — start Ollama or set AI_PROVIDER");
  }
  const params: Record<string, unknown> = {
    query_embedding: vectors[0],
    match_count: limit,
  };
  if (userId) params.p_user_id = userId;
  const { data, error } = await supabase.rpc("match_memory_chunks", params);
  if (error) throw error;
  return (data ?? []) as MemoryHit[];
}
