-- 0002 — profiles (1:1 with auth.users; the spec's "users" table)
create table profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  timezone      text not null default 'UTC',          -- drives all "what day is it" math
  locale        text not null default 'en',
  targets       jsonb not null default '{}'::jsonb,    -- step/sleep/protein/etc. goals
  ai_provider   text not null default 'local'
                  check (ai_provider in ('local','anthropic','openai','hybrid')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Auto-create a profile row when a new auth user signs up.
create or replace function handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
