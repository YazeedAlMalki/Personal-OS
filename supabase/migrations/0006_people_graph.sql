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
