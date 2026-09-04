-- Personal OS V2 — all migrations concatenated (0001–0011). Paste into the Supabase SQL editor and run once.

-- ===== 0001_extensions.sql =====
-- 0001 — extensions
-- Personal OS V2. Run migrations in filename order.
create extension if not exists "uuid-ossp";
create extension if not exists vector;     -- pgvector: semantic memory
create extension if not exists pg_trgm;    -- fuzzy text / duplicate detection

-- ===== 0002_profiles.sql =====
-- 0002 — profiles (1:1 with auth.users; the spec's "users" table)
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  timezone      text not null default 'UTC',          -- drives all "what day is it" math
  locale        text not null default 'en',
  targets       jsonb not null default '{}'::jsonb,    -- step/sleep/protein/etc. goals
  ai_provider   text not null default 'local'
                  check (ai_provider in ('local','anthropic','openai','hybrid')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ===== 0003_capture_memory.sql =====
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

-- ===== 0004_work.sql =====
-- 0004 — work: goals, projects, tasks, time_logs

create table goals (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title               text not null,
  description         text,
  category            text,
  why_it_matters      text,
  deadline            date,
  status              text not null default 'active'
                        check (status in ('active','paused','done','dropped')),
  progress_percentage numeric(5,2) not null default 0 check (progress_percentage between 0 and 100),
  target_metric       numeric,
  current_metric      numeric,
  next_action         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index goals_user_status_idx on goals(user_id, status);

create table projects (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title               text not null,
  description         text,
  status              text not null default 'active'
                        check (status in ('active','paused','done','archived')),
  category            text,
  priority            text not null default 'medium' check (priority in ('low','medium','high','critical')),
  deadline            date,
  progress_percentage numeric(5,2) not null default 0 check (progress_percentage between 0 and 100),
  related_goal_id     uuid references goals(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index projects_user_status_idx on projects(user_id, status);

create table tasks (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title                  text not null,
  description            text,
  status                 text not null default 'todo'
                           check (status in ('todo','in_progress','blocked','done','dropped')),
  priority               text not null default 'medium'
                           check (priority in ('low','medium','high','urgent')),
  priority_score         double precision not null default 0,
  category               text,
  due_date               date,
  estimated_minutes      integer,
  actual_minutes         integer,
  postpone_count         integer not null default 0,
  source                 text,
  related_goal_id        uuid references goals(id) on delete set null,
  related_project_id     uuid references projects(id) on delete set null,
  related_contact_id     uuid,                 -- FK added in 0006
  related_opportunity_id uuid,                 -- FK added in 0006
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  completed_at           timestamptz
);
create index tasks_user_status_idx on tasks(user_id, status, due_date);
create index tasks_priority_idx   on tasks(user_id, priority_score desc) where status <> 'done';

create table time_logs (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  task_id          uuid references tasks(id) on delete set null,
  project_id       uuid references projects(id) on delete set null,
  category         text,
  start_time       timestamptz not null,
  end_time         timestamptz,
  duration_minutes integer generated always as
                     (case when end_time is null then null
                           else greatest(0, (extract(epoch from (end_time - start_time))/60)::int) end) stored,
  notes            text,
  created_at       timestamptz not null default now()
);
create index time_logs_user_time_idx on time_logs(user_id, start_time desc);

-- ===== 0005_decisions_opps_risks.sql =====
-- 0005 — decisions, opportunities, risks

create table opportunities (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null,
  description        text,
  category           text,
  estimated_value    numeric(14,2),
  probability        numeric(4,3) check (probability between 0 and 1),
  expected_value     numeric(16,2) generated always as
                       (round(coalesce(estimated_value,0) * coalesce(probability,0), 2)) stored,
  deadline           date,
  status             text not null default 'new'
                       check (status in ('new','researching','contacted','negotiating',
                                         'waiting','won','lost','archived')),
  next_action        text,
  related_contact_id uuid,                     -- FK added in 0006
  related_company_id uuid,                     -- FK added in 0006 (-> entities)
  risk_level         text check (risk_level in ('low','medium','high')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index opportunities_user_status_idx on opportunities(user_id, status, expected_value desc);

create table decisions (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null,
  decision           text,
  context            text,
  options_considered jsonb not null default '[]'::jsonb,
  assumptions        jsonb not null default '[]'::jsonb,
  expected_outcome   text,
  actual_outcome     text,
  review_date        date,
  status             text not null default 'open'
                       check (status in ('open','reviewing','reviewed','reversed')),
  lesson_learned     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index decisions_user_review_idx on decisions(user_id, review_date) where status <> 'reviewed';

create table risks (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null,
  description     text,
  category        text not null
                    check (category in ('health','finance','legal','career','business',
                                        'technical','relationship','time','security','data_loss')),
  probability     smallint check (probability between 1 and 5),
  impact          smallint check (impact between 1 and 5),
  risk_score      smallint generated always as (coalesce(probability,0) * coalesce(impact,0)) stored,
  mitigation_plan text,
  owner           text,
  status          text not null default 'open'
                    check (status in ('open','mitigating','monitoring','closed','accepted')),
  review_date     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index risks_user_score_idx on risks(user_id, risk_score desc) where status <> 'closed';

-- ===== 0006_people_graph.sql =====
-- 0006 — people & graph: entities, entity_relationships, contacts (+ deferred FKs)
-- entities is created before contacts and before the opportunities->entities FK.

-- Graph node table. People/companies/projects/tools/places/events/assets unify here.
create table entities (
  id               uuid primary key default uuid_generate_v4(),
  user_id          uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name             text not null,
  entity_type      text not null
                     check (entity_type in ('person','company','project','organization',
                                            'tool','location','event','asset')),
  description      text,
  importance_score numeric(5,2) not null default 0,
  metadata         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index entities_user_type_idx on entities(user_id, entity_type);
create index entities_name_trgm_idx on entities using gin (name gin_trgm_ops);

-- Graph edges. Directed, typed, weighted.
create table entity_relationships (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source_entity_id  uuid not null references entities(id) on delete cascade,
  target_entity_id  uuid not null references entities(id) on delete cascade,
  relationship_type text not null,
  strength          numeric(4,3) check (strength between 0 and 1),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  check (source_entity_id <> target_entity_id)
);
create index entity_rel_user_idx   on entity_relationships(user_id);
create index entity_rel_source_idx on entity_relationships(source_entity_id);
create index entity_rel_target_idx on entity_relationships(target_entity_id);

-- Contacts (may mirror into the graph via entity_id; entities now exists).
create table contacts (
  id                    uuid primary key default uuid_generate_v4(),
  user_id               uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name                  text not null,
  type                  text,
  role                  text,
  company               text,
  email                 text,
  phone                 text,
  relationship_strength smallint check (relationship_strength between 1 and 5),
  last_contacted_at     timestamptz,
  next_follow_up_at     timestamptz,
  notes                 text,
  entity_id             uuid references entities(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index contacts_user_followup_idx on contacts(user_id, next_follow_up_at);

-- Deferred FKs now that all referenced tables exist.
alter table tasks         add constraint tasks_contact_fk      foreign key (related_contact_id)     references contacts(id)      on delete set null;
alter table tasks         add constraint tasks_opportunity_fk  foreign key (related_opportunity_id) references opportunities(id) on delete set null;
alter table opportunities add constraint opp_contact_fk        foreign key (related_contact_id)     references contacts(id)      on delete set null;
alter table opportunities add constraint opp_company_fk        foreign key (related_company_id)     references entities(id)      on delete set null;

-- ===== 0007_health.sql =====
-- 0007 — health, fitness & nutrition

-- One summarized row per day. Written by HealthKit (Option A/B), Shortcuts, or manual.
create table health_daily (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date                 date not null,
  steps                integer,
  sleep_minutes        integer,
  sleep_start          timestamptz,
  sleep_end            timestamptz,
  deep_sleep_minutes   integer,
  rem_sleep_minutes    integer,
  resting_heart_rate   integer,
  hrv                  numeric(6,2),
  vo2_max              numeric(5,2),
  active_energy_burned numeric(8,2),
  workouts_count       integer,
  workout_minutes      integer,
  weight               numeric(6,2),
  body_fat_percentage  numeric(5,2),
  calories_consumed    integer,
  protein_grams        numeric(7,2),
  recovery_score       numeric(5,2),
  activity_score       numeric(5,2),
  nutrition_score      numeric(5,2),
  source               text not null default 'manual',  -- healthkit|shortcut|manual
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, date)
);
create index health_daily_user_date_idx on health_daily(user_id, date desc);

create table workouts (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date                date not null,
  workout_type        text,
  duration_minutes    integer,
  calories_burned     numeric(8,2),
  distance            numeric(8,2),
  average_heart_rate  integer,
  max_heart_rate      integer,
  source              text not null default 'manual',
  notes               text,
  created_at          timestamptz not null default now()
);
create index workouts_user_date_idx on workouts(user_id, date desc);

create table nutrition_logs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date        date not null,
  meal_name   text,
  calories    integer,
  protein     numeric(7,2),
  carbs       numeric(7,2),
  fat         numeric(7,2),
  ingredients jsonb not null default '[]'::jsonb,
  source      text not null default 'manual',
  notes       text,
  created_at  timestamptz not null default now()
);
create index nutrition_user_date_idx on nutrition_logs(user_id, date desc);

-- ===== 0008_finance_learning.sql =====
-- 0008 — finance & learning

create table finance_snapshots (
  id                     uuid primary key default uuid_generate_v4(),
  user_id                uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date                   date not null,
  assets                 numeric(16,2),
  liabilities            numeric(16,2),
  net_worth              numeric(16,2),
  income_month_to_date   numeric(14,2),
  expenses_month_to_date numeric(14,2),
  investment_value       numeric(16,2),
  cash_balance           numeric(16,2),
  currency               text not null default 'USD',
  source                 text not null default 'gsheet',
  notes                  text,
  created_at             timestamptz not null default now(),
  unique (user_id, date)
);
create index finance_user_date_idx on finance_snapshots(user_id, date desc);

create table learning_items (
  id                  uuid primary key default uuid_generate_v4(),
  user_id             uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title               text not null,
  type                text,
  subject             text,
  current_level       text,
  target_level        text,
  status              text not null default 'active'
                        check (status in ('queued','active','paused','done','dropped')),
  progress_percentage numeric(5,2) not null default 0 check (progress_percentage between 0 and 100),
  next_action         text,
  related_goal_id     uuid references goals(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index learning_user_status_idx on learning_items(user_id, status);

-- ===== 0009_journal_calendar_system.sql =====
-- 0009 — journal, calendar cache, insights, audit, exports

create table journal_entries (
  id            uuid primary key default uuid_generate_v4(),
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  raw_text      text not null,
  summary       text,
  mood          smallint check (mood between 1 and 5),
  energy_level  smallint check (energy_level between 1 and 5),
  stress_level  smallint check (stress_level between 1 and 5),
  sleep_quality smallint check (sleep_quality between 1 and 5),
  themes        jsonb not null default '[]'::jsonb,
  lessons       jsonb not null default '[]'::jsonb,
  action_items  jsonb not null default '[]'::jsonb,
  entry_date    date not null default current_date,
  created_at    timestamptz not null default now()
);
create index journal_user_date_idx on journal_entries(user_id, entry_date desc);

-- Read-only mirror of external calendars. Never the source of truth.
create table calendar_events_cache (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null default auth.uid() references auth.users(id) on delete cascade,
  external_calendar_id text,
  external_event_id    text,
  title                text,
  start_time           timestamptz not null,
  end_time             timestamptz,
  location             text,
  description          text,
  source               text not null default 'google',
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, source, external_event_id)
);
create index calevents_user_time_idx on calendar_events_cache(user_id, start_time);

-- Everything the Chief of Staff / forecaster surfaces lands here.
create table ai_insights (
  id                uuid primary key default uuid_generate_v4(),
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  insight_type      text not null,
  title             text not null,
  body              text,
  confidence_score  numeric(4,3) check (confidence_score between 0 and 1),
  related_table     text,
  related_record_id uuid,
  severity          text not null default 'info' check (severity in ('info','low','medium','high','critical')),
  status            text not null default 'new' check (status in ('new','seen','acted','dismissed','snoozed')),
  snooze_until      timestamptz,
  created_at        timestamptz not null default now()
);
create index ai_insights_user_status_idx on ai_insights(user_id, status, severity, created_at desc);
-- Idempotency: avoid duplicate alerts for the same thing on the same day.
-- Daily dedupe. Cast through a fixed UTC tz so the expression is IMMUTABLE
-- (plain created_at::date is only STABLE and Postgres rejects it in an index).
create unique index ai_insights_dedupe_idx
  on ai_insights(user_id, insight_type, related_record_id, ((created_at at time zone 'UTC')::date));

create table audit_log (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  action      text not null,
  table_name  text,
  record_id   uuid,
  old_value   jsonb,
  new_value   jsonb,
  source      text,
  created_at  timestamptz not null default now()
);
create index audit_user_idx on audit_log(user_id, created_at desc);

create table exports (
  id           uuid primary key default uuid_generate_v4(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind         text not null default 'full' check (kind in ('full','domain','manual')),
  storage_path text,
  row_counts   jsonb not null default '{}'::jsonb,
  status       text not null default 'success' check (status in ('success','partial','failed')),
  created_at   timestamptz not null default now()
);

-- ===== 0010_functions_triggers.sql =====
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

-- ===== 0011_rls_policies.sql =====
-- 0011 — Row Level Security: on for every table, owner predicate user_id = auth.uid().
-- profiles is special-cased (its PK *is* the user id).

do $$
declare
  t text;
  user_tables text[] := array[
    'raw_ingestion_events','review_queue','memory_chunks','data_quality_scores',
    'goals','projects','tasks','time_logs',
    'opportunities','decisions','risks',
    'entities','entity_relationships','contacts',
    'health_daily','workouts','nutrition_logs',
    'finance_snapshots','learning_items',
    'journal_entries','calendar_events_cache','ai_insights','audit_log','exports'
  ];
begin
  foreach t in array user_tables loop
    execute format('alter table %I enable row level security;', t);

    execute format('drop policy if exists %I on %I;', t || '_select', t);
    execute format('create policy %I on %I for select using (user_id = auth.uid());',
                   t || '_select', t);

    execute format('drop policy if exists %I on %I;', t || '_insert', t);
    execute format('create policy %I on %I for insert with check (user_id = auth.uid());',
                   t || '_insert', t);

    execute format('drop policy if exists %I on %I;', t || '_update', t);
    execute format('create policy %I on %I for update using (user_id = auth.uid()) with check (user_id = auth.uid());',
                   t || '_update', t);

    execute format('drop policy if exists %I on %I;', t || '_delete', t);
    execute format('create policy %I on %I for delete using (user_id = auth.uid());',
                   t || '_delete', t);
  end loop;
end $$;

-- profiles: id = auth.uid()
alter table profiles enable row level security;
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (id = auth.uid());
drop policy if exists profiles_insert on profiles;
create policy profiles_insert on profiles for insert with check (id = auth.uid());
drop policy if exists profiles_update on profiles;
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- ===== 0013_decisions_outcome.sql =====
alter table decisions
  add column if not exists assumption_confidence numeric(4,3)
    check (assumption_confidence between 0 and 1),
  add column if not exists outcome_score numeric(4,3)
    check (outcome_score between 0 and 1),
  add column if not exists outcome_reviewed_at timestamptz;

create index if not exists decisions_user_outcome_idx
  on decisions(user_id, outcome_reviewed_at desc)
  where outcome_score is not null;

-- ============================================================================
-- 0014 — Phase 8 performance index review.
-- ============================================================================
create index if not exists ai_insights_type_table_idx
  on ai_insights (user_id, insight_type, related_table, created_at desc)
  where status <> 'dismissed';

create index if not exists entity_rel_pair_idx
  on entity_relationships (user_id, source_entity_id, target_entity_id);

-- ===== 0015_memory_search_admin.sql =====
-- Override match_memory_chunks to accept optional p_user_id for service-role callers.
-- Drop the 0010 2-arg version first to avoid leaving an ambiguous overload behind.
drop function if exists match_memory_chunks(vector(768), int);
create or replace function match_memory_chunks(
  query_embedding vector(768),
  match_count int default 20,
  p_user_id uuid default null
) returns table (
  id uuid, source_type text, source_id uuid, text text, similarity float, created_at timestamptz
)
language sql stable as $$
  select id, source_type, source_id, text,
         1 - (embedding <=> query_embedding) as similarity, created_at
  from memory_chunks
  where user_id = coalesce(p_user_id, auth.uid()) and embedding is not null
  order by embedding <=> query_embedding
  limit match_count;
$$;
