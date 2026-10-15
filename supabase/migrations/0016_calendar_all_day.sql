-- 0016 — all-day flag on calendar_events_cache.
-- ICS VALUE=DATE events are calendar dates, not instants. They are stored at
-- UTC midnight; without this flag the UI rendered them as 03:00 Riyadh timed
-- events. Additive and idempotent: existing rows default to false and the next
-- ICS sync (upsert on external_event_id) sets the flag on all-day rows.
alter table calendar_events_cache
  add column if not exists all_day boolean not null default false;
