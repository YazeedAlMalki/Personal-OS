-- ============================================================================
-- RLS / security test suite — the Phase 8 gate (architecture §15).
--
-- Run against a database that has migrations 0001–0013 applied:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f tests/rls/rls_policies.test.sql
-- or:  ./scripts/run-rls-tests.sh
--
-- Everything runs inside ONE transaction that ROLLS BACK at the end, so it
-- leaves no test data behind. Any failed assertion RAISEs and (with
-- ON_ERROR_STOP=1) aborts with a non-zero exit — suitable for CI.
--
-- IMPORTANT: the actor segments call `set local role authenticated|anon` so RLS
-- is actually enforced (a superuser connection bypasses RLS). Connecting as
-- `postgres` is fine — every segment switches role explicitly and RESETs
-- between segments.
--
-- Covers, per architecture §15:
--   1. RLS enabled on every application table (26 tables incl. profiles).
--   2. Each owner-scoped table exposes select/insert/update/delete policies.
--   3. Cross-user ISOLATION: user A's rows are invisible to user B (16 tables).
--   4. user_id FORGERY is rejected (WITH CHECK user_id = auth.uid()).
--   5. The anon role sees nothing.
--   6. Generated columns compute correctly (expected_value, risk_score,
--      duration_minutes).
--   7. match_memory_chunks() filters by auth.uid().
-- ============================================================================

begin;
set local client_min_messages = warning;

-- Two fake users (superuser setup context — before any role switch).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'b@test.local')
on conflict (id) do nothing;

-- Act as a given authenticated user: set the JWT 'sub' claim auth.uid() reads.
-- (Role is switched separately with `set local role authenticated`.)
create or replace function _login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text,
    true
  );
end $$;

-- A 768-d embedding literal, reused for the memory_chunks tests.
create or replace function _vec768() returns text language sql immutable as $$
  select '[' || array_to_string(array_fill(0.0013::float8, array[768]), ',') || ']';
$$;

-- ============================================================================
-- TEST 1 — RLS is enabled on every application table.
-- ============================================================================
do $$
declare
  t text;
  secured boolean;
  tbls text[] := array[
    'profiles','raw_ingestion_events','review_queue','memory_chunks',
    'data_quality_scores','goals','projects','tasks','time_logs',
    'opportunities','decisions','risks','entities','entity_relationships',
    'contacts','health_daily','workouts','nutrition_logs','finance_snapshots',
    'learning_items','journal_entries','calendar_events_cache','ai_insights',
    'audit_log','exports','quadrant_corrections'
  ];
begin
  foreach t in array tbls loop
    select c.relrowsecurity into secured
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = t;
    if secured is null then
      raise exception 'TEST 1 FAIL: table public.% does not exist', t;
    end if;
    if not secured then
      raise exception 'TEST 1 FAIL: RLS not enabled on %', t;
    end if;
  end loop;
  raise notice 'TEST 1 ok — RLS enabled on all % tables', array_length(tbls, 1);
end $$;

-- ============================================================================
-- TEST 2 — every owner-scoped table has all four CRUD policies.
-- profiles + quadrant_corrections are special-cased (>= 1 policy is enough).
-- ============================================================================
do $$
declare
  t text;
  cmds int;
  std text[] := array[
    'raw_ingestion_events','review_queue','memory_chunks','data_quality_scores',
    'goals','projects','tasks','time_logs','opportunities','decisions','risks',
    'entities','entity_relationships','contacts','health_daily','workouts',
    'nutrition_logs','finance_snapshots','learning_items','journal_entries',
    'calendar_events_cache','ai_insights','audit_log','exports'
  ];
  special text[] := array['profiles','quadrant_corrections'];
begin
  foreach t in array std loop
    select count(distinct cmd) into cmds
    from pg_policies where schemaname = 'public' and tablename = t;
    if cmds < 4 then
      raise exception 'TEST 2 FAIL: % exposes only % of 4 CRUD policy types', t, cmds;
    end if;
  end loop;
  foreach t in array special loop
    select count(*) into cmds
    from pg_policies where schemaname = 'public' and tablename = t;
    if cmds < 1 then
      raise exception 'TEST 2 FAIL: % has no RLS policy', t;
    end if;
  end loop;
  raise notice 'TEST 2 ok — CRUD policies present on all owner-scoped tables';
end $$;

-- ============================================================================
-- Seed user A's data AS user A (also exercises every INSERT policy).
-- Fixed UUIDs let later segments reference these rows.
-- ============================================================================
set local role authenticated;
select _login('11111111-1111-1111-1111-111111111111');

insert into tasks (title) values ('A private task');
insert into goals (title) values ('A private goal');
insert into projects (title) values ('A private project');
insert into decisions (title) values ('A private decision');
insert into contacts (name) values ('A private contact');
insert into learning_items (title) values ('A private lesson');
insert into journal_entries (raw_text) values ('A private journal');
insert into health_daily (date) values (current_date);
insert into finance_snapshots (date) values (current_date);
insert into review_queue (reason) values ('low_confidence');

-- Generated-column fixtures.
insert into opportunities (id, title, estimated_value, probability)
  values ('aaaa0001-0000-0000-0000-000000000001', 'A opportunity', 1000, 0.5);
insert into risks (title, category, probability, impact)
  values ('A risk', 'time', 3, 4);
insert into time_logs (start_time, end_time)
  values (timestamptz '2026-06-01 09:00+00', timestamptz '2026-06-01 10:00+00');

-- Graph + memory fixtures (entity id fixed for the relationship + chunk).
insert into entities (id, name, entity_type)
  values ('aaaa0002-0000-0000-0000-000000000002', 'Acme', 'company');
insert into entity_relationships (source_entity_id, target_entity_id, relationship_type)
  values ('aaaa0002-0000-0000-0000-000000000002',
          'aaaa0002-0000-0000-0000-000000000002', 'self')
  on conflict do nothing;
insert into memory_chunks (source_type, source_id, text, embedding)
  values ('journal', 'aaaa0002-0000-0000-0000-000000000002',
          'A private memory', (_vec768())::vector);

-- ============================================================================
-- TEST 6 — generated columns compute correctly (asserted as the owner).
-- ============================================================================
do $$
declare ev numeric; rs int; dm int;
begin
  select expected_value into ev from opportunities
    where id = 'aaaa0001-0000-0000-0000-000000000001';
  if ev is distinct from 500.00 then
    raise exception 'TEST 6 FAIL: opportunities.expected_value = % (expected 500.00)', ev;
  end if;

  select risk_score into rs from risks where title = 'A risk';
  if rs is distinct from 12 then
    raise exception 'TEST 6 FAIL: risks.risk_score = % (expected 12)', rs;
  end if;

  select duration_minutes into dm from time_logs
    where start_time = timestamptz '2026-06-01 09:00+00';
  if dm is distinct from 60 then
    raise exception 'TEST 6 FAIL: time_logs.duration_minutes = % (expected 60)', dm;
  end if;

  raise notice 'TEST 6 ok — generated columns (expected_value/risk_score/duration_minutes)';
end $$;

-- ============================================================================
-- TEST 4 — forging user_id is rejected by the INSERT WITH CHECK.
-- ============================================================================
do $$
begin
  begin
    insert into tasks (title, user_id)
      values ('forged', '22222222-2222-2222-2222-222222222222');
    raise exception 'TEST 4 FAIL: forged user_id insert was allowed';
  exception
    when insufficient_privilege or check_violation then
      raise notice 'TEST 4 ok — forged user_id rejected (%)', sqlstate;
  end;
end $$;

-- ============================================================================
-- TEST 7 (owner half) — match_memory_chunks returns A's chunk for A.
-- ============================================================================
do $$
declare n int;
begin
  select count(*) into n
  from match_memory_chunks((_vec768())::vector, 20);
  if n < 1 then
    raise exception 'TEST 7 FAIL: owner saw % memory matches (expected >= 1)', n;
  end if;
  raise notice 'TEST 7a ok — match_memory_chunks returns owner rows (%)', n;
end $$;

-- ============================================================================
-- TEST 3 — ISOLATION: user B sees none of A's rows, and cannot delete them.
-- ============================================================================
reset role;
set local role authenticated;
select _login('22222222-2222-2222-2222-222222222222');

do $$
declare
  t text;
  n int;
  tbls text[] := array[
    'tasks','goals','projects','decisions','contacts','learning_items',
    'journal_entries','health_daily','finance_snapshots','review_queue',
    'opportunities','risks','time_logs','entities','entity_relationships',
    'memory_chunks'
  ];
begin
  foreach t in array tbls loop
    execute format('select count(*) from %I', t) into n;
    if n <> 0 then
      raise exception 'TEST 3 FAIL: user B sees % row(s) in % (expected 0)', n, t;
    end if;
  end loop;
  raise notice 'TEST 3 ok — user B is isolated from A across % tables', array_length(tbls, 1);
end $$;

-- B cannot delete A's tasks (delete sees zero rows → affects zero).
do $$
declare n int;
begin
  delete from tasks;
  get diagnostics n = row_count;
  if n <> 0 then
    raise exception 'TEST 3 FAIL: user B deleted % of A''s tasks — RLS breach', n;
  end if;
  raise notice 'TEST 3 ok — user B cannot delete A''s rows';
end $$;

-- TEST 7 (isolation half) — match_memory_chunks returns nothing for B.
do $$
declare n int;
begin
  select count(*) into n from match_memory_chunks((_vec768())::vector, 20);
  if n <> 0 then
    raise exception 'TEST 7 FAIL: user B saw % of A''s memory chunks', n;
  end if;
  raise notice 'TEST 7b ok — match_memory_chunks is user-scoped';
end $$;

-- ============================================================================
-- TEST 5 — the anon role sees nothing (either 0 rows or permission denied).
-- ============================================================================
reset role;
set local role anon;
select set_config('request.jwt.claims', json_build_object('role','anon')::text, true);

do $$
declare
  t text;
  n int;
  tbls text[] := array['tasks','goals','opportunities','memory_chunks','health_daily'];
begin
  foreach t in array tbls loop
    begin
      execute format('select count(*) from %I', t) into n;
      if n <> 0 then
        raise exception 'TEST 5 FAIL: anon sees % row(s) in %', n, t;
      end if;
    exception
      when insufficient_privilege then
        null; -- no grant at all is an even stronger pass
    end;
  end loop;
  raise notice 'TEST 5 ok — anon role sees no rows';
end $$;

reset role;
do $$ begin raise notice 'ALL RLS TESTS PASSED.'; end $$;
rollback;  -- leave no test data behind
