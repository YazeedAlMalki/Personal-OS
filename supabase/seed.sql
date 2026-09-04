-- Demo seed for Personal OS V2.
-- Run AFTER you've signed up at least one user (Authentication → Users, or via /signup).
-- Safe to run in the Supabase SQL editor (it runs as a privileged role and sets user_id
-- to your first user). Idempotent-ish: clears prior demo rows by a known marker first.

do $$
declare
  uid uuid;
  raw_id uuid;
  i int;
  sam_e uuid; dana_e uuid; acme_e uuid; northwind_e uuid; posv2_e uuid;
  sam_contact uuid;
begin
  select id into uid from auth.users order by created_at limit 1;
  if uid is null then
    raise notice 'No user found. Sign up first, then re-run seed.sql.';
    return;
  end if;

  -- ---- GOALS (one stale → triggers inactive_goal) -----------------------
  insert into goals (user_id, title, category, status, progress_percentage, deadline, updated_at, why_it_matters, next_action) values
    (uid, 'Ship Personal OS V2', 'career', 'active', 35, current_date + 45, now() - interval '30 days', 'My daily operating system', 'Finish Phase 2'),
    (uid, 'Run a half marathon', 'health', 'active', 60, current_date + 90, now(), 'Long-term fitness', 'Long run Saturday');

  -- ---- PROJECTS (one stalled → triggers stalled_project) ----------------
  insert into projects (user_id, title, status, priority, progress_percentage, updated_at) values
    (uid, 'Personal OS build', 'active', 'high', 35, now() - interval '25 days'),
    (uid, 'Q2 tax filing', 'active', 'medium', 10, now());

  -- ---- TASKS (overdue + serial-postpone → 2 alerts) ---------------------
  insert into tasks (user_id, title, status, priority, due_date, postpone_count, updated_at) values
    (uid, 'Email accountant about Q2', 'todo', 'high', current_date - 3, 0, now()),     -- overdue
    (uid, 'Refactor capture pipeline', 'todo', 'medium', null, 4, now()),               -- postponed 4x
    (uid, 'Book dentist', 'todo', 'low', current_date + 5, 1, now()),
    (uid, 'Draft investor update', 'in_progress', 'high', current_date + 1, 0, now()),
    (uid, 'Buy running shoes', 'todo', 'medium', null, 0, now());

  -- ---- OPPORTUNITIES (idle high-value → triggers idle_opportunity) -------
  insert into opportunities (user_id, title, status, estimated_value, probability, next_action, deadline) values
    (uid, 'Consulting retainer — Acme', 'negotiating', 50000, 0.6, null, current_date + 20),
    (uid, 'Affiliate partnership', 'contacted', 8000, 0.4, 'Send proposal', current_date + 14);

  -- ---- RISKS (high score, no mitigation → unmitigated_risk) -------------
  insert into risks (user_id, title, category, probability, impact, mitigation_plan, status) values
    (uid, 'Single point of failure: home server', 'technical', 4, 4, null, 'open'),
    (uid, 'Cash runway under 6 months', 'finance', 3, 3, 'Cut discretionary spend; line up retainer', 'mitigating');

  -- ---- CONTACTS (one drifting → stale_follow_up) ------------------------
  insert into contacts (user_id, name, type, company, relationship_strength, last_contacted_at) values
    (uid, 'Sam Rivera', 'mentor', 'Northwind', 4, now() - interval '40 days'),
    (uid, 'Dana Lee', 'client', 'Acme', 5, now() - interval '3 days');

  -- ---- DECISIONS (review due → decision_review) -------------------------
  insert into decisions (user_id, title, decision, status, review_date) values
    (uid, 'Self-host vs cloud DB', 'Stay on Supabase cloud for now', 'open', current_date - 5);

  -- ---- LEARNING ---------------------------------------------------------
  insert into learning_items (user_id, title, type, subject, status, progress_percentage) values
    (uid, 'Designing Data-Intensive Applications', 'book', 'systems', 'active', 40),
    (uid, 'Spanish B1', 'skill', 'language', 'active', 25);

  -- ---- JOURNAL ----------------------------------------------------------
  insert into journal_entries (user_id, raw_text, summary, mood, energy_level, entry_date) values
    (uid, 'Productive day. Shipped the capture pipeline and felt focused.', 'Shipped capture pipeline', 4, 4, current_date),
    (uid, 'Tired, slept poorly. Need to protect evenings.', 'Low energy, poor sleep', 2, 2, current_date - 1);

  -- ---- HEALTH (last 7 days) --------------------------------------------
  for i in 0..6 loop
    insert into health_daily (user_id, date, steps, sleep_minutes, resting_heart_rate, active_energy_burned, source)
    values (uid, current_date - i, 5200 + i * 450, 360 + i * 12, 57 + (i % 4), 380 + i * 20, 'manual')
    on conflict (user_id, date) do nothing;
  end loop;

  -- ---- GRAPH (Phase 6): entities, edges, contact mirrors, record links ---
  -- Wires the "done when" gate: clicking Sam Rivera shows his company
  -- (Northwind), the opportunity he introduced (Acme retainer) and linked tasks.
  insert into entities (user_id, name, entity_type, description, importance_score, metadata) values
    (uid, 'Sam Rivera', 'person',  'Mentor; introduced the Acme retainer', 72,
      jsonb_build_object('mention_count', 6, 'last_mentioned_at', to_char((now() - interval '2 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    (uid, 'Dana Lee',   'person',  'Client contact at Acme', 55,
      jsonb_build_object('mention_count', 3, 'last_mentioned_at', to_char((now() - interval '3 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    (uid, 'Acme',       'company', 'Client — consulting retainer', 80,
      jsonb_build_object('mention_count', 8, 'last_mentioned_at', to_char((now() - interval '1 day') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    (uid, 'Northwind',  'company', E'Sam\'s company', 30,
      jsonb_build_object('mention_count', 2, 'last_mentioned_at', to_char((now() - interval '12 days') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))),
    (uid, 'Personal OS','project', 'This system', 40,
      jsonb_build_object('mention_count', 5, 'last_mentioned_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')));

  select id into sam_e       from entities where user_id = uid and name = 'Sam Rivera';
  select id into dana_e      from entities where user_id = uid and name = 'Dana Lee';
  select id into acme_e      from entities where user_id = uid and name = 'Acme';
  select id into northwind_e from entities where user_id = uid and name = 'Northwind';
  select id into posv2_e     from entities where user_id = uid and name = 'Personal OS';

  insert into entity_relationships (user_id, source_entity_id, target_entity_id, relationship_type, strength) values
    (uid, sam_e,   northwind_e, 'works_at',       0.9),
    (uid, dana_e,  acme_e,      'works_at',       0.9),
    (uid, sam_e,   acme_e,      'introduced',     0.7),
    (uid, sam_e,   dana_e,      'knows',          0.6),
    (uid, posv2_e, sam_e,       'mentioned_with', 0.3);

  -- Mirror the CRM contacts into the graph and link records to them.
  update contacts set entity_id = sam_e  where user_id = uid and name = 'Sam Rivera';
  update contacts set entity_id = dana_e where user_id = uid and name = 'Dana Lee';
  select id into sam_contact from contacts where user_id = uid and name = 'Sam Rivera';
  update opportunities
     set related_contact_id = sam_contact, related_company_id = acme_e
   where user_id = uid and title = 'Consulting retainer — Acme';
  insert into tasks (user_id, title, status, priority, due_date, related_contact_id) values
    (uid, 'Send thank-you note to Sam Rivera', 'todo', 'medium', current_date + 2, sam_contact);

  -- ---- A low-confidence capture sitting in the review queue --------------
  insert into raw_ingestion_events (user_id, source, content_type, raw_content, processing_status, classification)
    values (uid, 'web', 'text', 'maybe look into that thing later', 'needs_review', '{"kind":"note","confidence":0.45}'::jsonb)
    returning id into raw_id;
  insert into review_queue (user_id, raw_event_id, proposed_table, proposed_record, reason, confidence)
    values (uid, raw_id, 'journal_entries',
            '{"raw_text":"maybe look into that thing later","summary":"look into that thing"}'::jsonb,
            'low_confidence', 0.45);

  raise notice 'Seed complete for user %', uid;
end $$;
