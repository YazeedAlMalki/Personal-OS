-- 0010 — shared functions & triggers

-- updated_at maintenance
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','goals','projects','tasks','opportunities','decisions','risks',
    'contacts','entities','entity_relationships','health_daily','learning_items',
    'calendar_events_cache'
  ] loop
    execute format('drop trigger if exists %1$s_set_updated_at on %1$s;', t);
    execute format('create trigger %1$s_set_updated_at before update on %1$s
                    for each row execute function set_updated_at();', t);
  end loop;
end $$;

-- Vector similarity search RPC (dimension must match memory_chunks.embedding).
create or replace function match_memory_chunks(
  query_embedding vector(768),
  match_count int default 20
) returns table (id uuid, source_type text, source_id uuid, text text, similarity float, created_at timestamptz)
language sql stable as $$
  select id, source_type, source_id, text,
         1 - (embedding <=> query_embedding) as similarity, created_at
  from memory_chunks
  where user_id = auth.uid() and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
