-- 0003 — capture, memory & reliability (the spine)

-- Durable landing zone for EVERY inbound signal. Written before processing.
create table raw_ingestion_events (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source            text not null,            -- telegram | web | shortcut | healthkit | gsheet | manual
  content_type      text not null,            -- text | audio | photo | file | json
  raw_content       text,
  storage_path      text,
  processing_status text not null default 'pending'
                      check (processing_status in ('pending','processing','done','needs_review','error')),
  error_message     text,
  classification    jsonb not null default '{}'::jsonb,
  routed_to         text,
  routed_id         uuid,
  created_at        timestamptz not null default now(),
  processed_at      timestamptz
);
create index raw_ingestion_user_status_idx on raw_ingestion_events(user_id, processing_status, created_at desc);

-- Human-in-the-loop queue for low-confidence extractions.
create table review_queue (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  raw_event_id    uuid references raw_ingestion_events(id) on delete cascade,
  proposed_table  text not null,
  proposed_record jsonb not null,
  reason          text not null,
  confidence      numeric(4,3) check (confidence between 0 and 1),
  status          text not null default 'open' check (status in ('open','accepted','rejected','edited')),
  resolved_record jsonb,
  created_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index review_queue_user_status_idx on review_queue(user_id, status, created_at desc);

-- Vector memory. vector(768) = local nomic-embed-text. Keep EMBEDDING_DIM in sync.
create table memory_chunks (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_type     text not null,
  source_id       uuid,
  text            text not null,
  embedding       vector(768),
  embedding_model text not null default 'nomic-embed-text',
  created_at      timestamptz not null default now()
);
create index memory_chunks_user_idx on memory_chunks(user_id);
create index memory_chunks_embedding_idx
  on memory_chunks using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- Per-record data quality scoring.
create table data_quality_scores (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  table_name      text not null,
  record_id       uuid not null,
  completeness    numeric(4,3) check (completeness between 0 and 1),
  freshness       numeric(4,3) check (freshness between 0 and 1),
  consistency     numeric(4,3) check (consistency between 0 and 1),
  quality_score   numeric(4,3) generated always as
                    (round((coalesce(completeness,0)*0.5
                          + coalesce(freshness,0)*0.3
                          + coalesce(consistency,0)*0.2)::numeric, 3)) stored,
  issues          jsonb not null default '[]'::jsonb,
  scored_at       timestamptz not null default now(),
  unique (user_id, table_name, record_id)
);
