-- 0014 — Phase 8 performance index review.
--
-- The forecast surfacing added in Phase 7 (dashboard, /insights, and the new
-- per-module ModuleForecasts panels) all query ai_insights by
--   (insight_type, related_table, status) order by created_at desc
-- The existing ai_insights_user_status_idx leads with (user_id, status, …) and
-- doesn't cover insight_type/related_table, so those reads fall back to a scan.
-- This partial index serves the forecast/correlation read paths directly.

create index if not exists ai_insights_type_table_idx
  on ai_insights (user_id, insight_type, related_table, created_at desc)
  where status <> 'dismissed';

-- entity_relationships are looked up by source and by target when expanding a
-- node's neighbours (Phase 6 EntityPanel). source/target already have indexes
-- (0006); this composite supports the de-dupe lookup used when the pipeline
-- records a co-mention edge in either direction.
create index if not exists entity_rel_pair_idx
  on entity_relationships (user_id, source_entity_id, target_entity_id);
