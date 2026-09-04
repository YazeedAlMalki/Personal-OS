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
