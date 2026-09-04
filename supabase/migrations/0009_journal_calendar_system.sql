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
