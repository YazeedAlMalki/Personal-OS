-- 0005 — decisions, opportunities, risks

create table opportunities (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null,
  description        text,
  category           text,
  estimated_value    numeric(14,2),
  probability        numeric(4,3) check (probability between 0 and 1),
  expected_value     numeric(16,2) generated always as
                       (round(coalesce(estimated_value,0) * coalesce(probability,0), 2)) stored,
  deadline           date,
  status             text not null default 'new'
                       check (status in ('new','researching','contacted','negotiating',
                                         'waiting','won','lost','archived')),
  next_action        text,
  related_contact_id uuid,                     -- FK added in 0006
  related_company_id uuid,                     -- FK added in 0006 (-> entities)
  risk_level         text check (risk_level in ('low','medium','high')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index opportunities_user_status_idx on opportunities(user_id, status, expected_value desc);

create table decisions (
  id                 uuid primary key default uuid_generate_v4(),
  user_id            uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title              text not null,
  decision           text,
  context            text,
  options_considered jsonb not null default '[]'::jsonb,
  assumptions        jsonb not null default '[]'::jsonb,
  expected_outcome   text,
  actual_outcome     text,
  review_date        date,
  status             text not null default 'open'
                       check (status in ('open','reviewing','reviewed','reversed')),
  lesson_learned     text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index decisions_user_review_idx on decisions(user_id, review_date) where status <> 'reviewed';

create table risks (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title           text not null,
  description     text,
  category        text not null
                    check (category in ('health','finance','legal','career','business',
                                        'technical','relationship','time','security','data_loss')),
  probability     smallint check (probability between 1 and 5),
  impact          smallint check (impact between 1 and 5),
  risk_score      smallint generated always as (coalesce(probability,0) * coalesce(impact,0)) stored,
  mitigation_plan text,
  owner           text,
  status          text not null default 'open'
                    check (status in ('open','mitigating','monitoring','closed','accepted')),
  review_date     date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index risks_user_score_idx on risks(user_id, risk_score desc) where status <> 'closed';
