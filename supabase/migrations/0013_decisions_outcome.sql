-- 0013 — decisions: confidence in assumptions + outcome score for review.
-- These two columns power the 8th cross-domain correlation (assumption-quality
-- vs outcome) emitted by lib/analytics/runner.ts.
--
-- assumption_confidence: how sure were you when the decision was made? (0..1)
-- outcome_score:         how did it actually turn out? (0..1, set on review)
-- outcome_reviewed_at:   when the outcome was scored (auditability).

alter table decisions
  add column if not exists assumption_confidence numeric(4,3)
    check (assumption_confidence between 0 and 1),
  add column if not exists outcome_score numeric(4,3)
    check (outcome_score between 0 and 1),
  add column if not exists outcome_reviewed_at timestamptz;

create index if not exists decisions_user_outcome_idx
  on decisions(user_id, outcome_reviewed_at desc)
  where outcome_score is not null;
