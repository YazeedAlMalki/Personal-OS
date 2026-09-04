-- 0015 — memory search with explicit user_id (for service-role callers).
-- Overrides match_memory_chunks to accept an optional p_user_id parameter.
-- RLS callers (web) pass no p_user_id → auth.uid() is used as before.
-- Service-role callers (Telegram bot, crons) pass p_user_id explicitly
-- to bypass the auth.uid() = NULL issue that returns empty results.
-- NOTE: 0010 created a 2-arg (query_embedding, match_count) version. Adding the
-- p_user_id arg changes the signature, so a plain create-or-replace would leave a
-- SECOND overload behind and 2-arg calls would become ambiguous. Drop the old
-- version first so exactly one function remains.
drop function if exists match_memory_chunks(vector(768), int);

create or replace function match_memory_chunks(
  query_embedding vector(768),
  match_count int default 20,
  p_user_id uuid default null
) returns table (
  id uuid,
  source_type text,
  source_id uuid,
  text text,
  similarity float,
  created_at timestamptz
)
language sql stable as $$
  select id, source_type, source_id, text,
         1 - (embedding <=> query_embedding) as similarity,
         created_at
  from memory_chunks
  where user_id = coalesce(p_user_id, auth.uid())
    and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
