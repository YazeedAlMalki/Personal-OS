-- ============================================================================
-- PENDING MIGRATIONS — found missing from the LIVE DB on 2026-06-11
-- (live check: tasks.quadrant and decisions.outcome_score don't exist).
--
-- This is 0012 + 0013 + 0014 in order, rewritten to be IDEMPOTENT — safe to
-- paste into the Supabase SQL editor and run, even more than once.
-- Until this runs: Eisenhower scoring on capture is silently skipped (caught),
-- the /matrix views have no quadrant data, and the decision-confidence
-- analytics pair finds no columns.
-- ============================================================================

-- ---- 0012 — Eisenhower Matrix ----------------------------------------------

alter table tasks
  add column if not exists urgency_score    smallint not null default 50
    check (urgency_score between 0 and 100),
  add column if not exists importance_score smallint not null default 50
    check (importance_score between 0 and 100),
  add column if not exists quadrant         text
    check (quadrant in ('do_now','schedule','delegate','drop')),
  add column if not exists quadrant_confidence numeric(3,2) not null default 0.50
    check (quadrant_confidence between 0 and 1),
  add column if not exists quadrant_reason  text,
  add column if not exists user_corrected_quadrant text
    check (user_corrected_quadrant in ('do_now','schedule','delegate','drop'));

create index if not exists tasks_quadrant_idx
  on tasks(user_id, quadrant)
  where status not in ('done','dropped');

create table if not exists quadrant_corrections (
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

create index if not exists quadrant_corrections_user_idx
  on quadrant_corrections(user_id, created_at desc);

alter table quadrant_corrections enable row level security;

drop policy if exists "Users see own corrections" on quadrant_corrections;
create policy "Users see own corrections"
  on quadrant_corrections for select
  using (user_id = auth.uid());

drop policy if exists "Users insert own corrections" on quadrant_corrections;
create policy "Users insert own corrections"
  on quadrant_corrections for insert
  with check (user_id = auth.uid());

-- ---- 0013 — decision outcome columns (already idempotent) ------------------

alter table decisions
  add column if not exists assumption_confidence numeric(4,3)
    check (assumption_confidence between 0 and 1),
  add column if not exists outcome_score numeric(4,3)
    check (outcome_score between 0 and 1),
  add column if not exists outcome_reviewed_at timestamptz;

create index if not exists decisions_user_outcome_idx
  on decisions(user_id, outcome_reviewed_at desc)
  where outcome_score is not null;

-- ---- 0014 — perf indexes (already idempotent) ------------------------------

create index if not exists ai_insights_type_table_idx
  on ai_insights (user_id, insight_type, related_table, created_at desc)
  where status <> 'dismissed';

create index if not exists entity_rel_pair_idx
  on entity_relationships (user_id, source_entity_id, target_entity_id);
