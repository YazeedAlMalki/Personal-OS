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
