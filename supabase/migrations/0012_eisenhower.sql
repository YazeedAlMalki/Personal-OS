-- 0012 — Eisenhower Matrix: urgency/importance scoring + quadrant assignment.
-- Adds columns to tasks and a correction log for user overrides.

-- New columns on tasks -------------------------------------------------------

alter table tasks
  add column urgency_score    smallint not null default 50
    check (urgency_score between 0 and 100),
  add column importance_score smallint not null default 50
    check (importance_score between 0 and 100),
  add column quadrant         text
    check (quadrant in ('do_now','schedule','delegate','drop')),
  add column quadrant_confidence numeric(3,2) not null default 0.50
    check (quadrant_confidence between 0 and 1),
  add column quadrant_reason  text,
  add column user_corrected_quadrant text
    check (user_corrected_quadrant in ('do_now','schedule','delegate','drop'));

-- Fast lookup: open tasks by quadrant for the dashboard grid.
create index tasks_quadrant_idx
  on tasks(user_id, quadrant)
  where status not in ('done','dropped');

-- Correction log — every user override, for calibration and audit. -----------

create table quadrant_corrections (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid()
                    references auth.users(id) on delete cascade,
  task_id         uuid not null references tasks(id) on delete cascade,
  from_quadrant   text not null
                    check (from_quadrant in ('do_now','schedule','delegate','drop')),
  to_quadrant     text not null
                    check (to_quadrant in ('do_now','schedule','delegate','drop')),
  reason          text,
  created_at      timestamptz not null default now()
);

create index quadrant_corrections_user_idx
  on quadrant_corrections(user_id, created_at desc);

-- RLS on quadrant_corrections ------------------------------------------------

alter table quadrant_corrections enable row level security;

create policy "Users see own corrections"
  on quadrant_corrections for select
  using (user_id = auth.uid());

create policy "Users insert own corrections"
  on quadrant_corrections for insert
  with check (user_id = auth.uid());
