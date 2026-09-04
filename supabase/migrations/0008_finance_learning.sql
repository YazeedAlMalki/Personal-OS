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
