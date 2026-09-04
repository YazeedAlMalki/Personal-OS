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
