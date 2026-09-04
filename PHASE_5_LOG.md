# Phase 5 — Health/fitness · session log

**Date:** 2026-06-10 · **Result:** Phase 5 built. `next build` ✓ all routes registered, `tsc --noEmit` ✓, vitest 147/148 (the only failure is the pre-existing eisenhower TZ test in UTC sandboxes — unchanged, your machine won't hit it). 26 new tests, all green.

## What ships

**Endpoint contract — both iPhone paths converge here.**
`POST /api/ingest/healthkit` with `Authorization: Bearer $HEALTHKIT_INGEST_SECRET`. Idempotent upsert on `(user_id, date)`. Accepts the full §12.4 payload — Option A (Swift HealthKit) and Option B (Apple Shortcuts) both POST the same shape. Embedded `workouts[]` are inserted as `workouts` rows and aggregated into `health_daily.workouts_count` + `workout_minutes`.

**Manual + integration entry points.**
- `POST /api/health` — upsert one day (server: `lib/domains/health.upsertHealthDaily`).
- `POST /api/workouts` — log a workout; rolls into `health_daily` counters.
- `POST /api/nutrition` — log a meal; rolls calories/protein into `health_daily`.
- `GET` variants take `?days=N`.
- `GET/PATCH /api/settings/targets` — tune step/sleep/protein goals (stored in `profiles.targets` jsonb).

**Deterministic scoring, every write.**
After any upsert the system recomputes recovery / activity / nutrition for the affected day. Formulas: §6 of the architecture. New `lib/scoring/baselines.ts` adds rolling 30d RHR/HRV baselines (falls back to `profiles.targets` or the global defaults when fewer than 7 readings), sleep consistency, and a prior-day strain proxy.

**Nightly job: `POST /api/cron/health-scores`** (Bearer `$CRON_SECRET`). Re-scores every user's last 7 days so late HealthKit uploads and updated nutrition logs catch up. Wired into `vercel.json` (09:00 daily) and `scripts/run-cron.sh`.

**Health dashboard (`/health`).**
Three score tiles (recovery / activity / nutrition) with 14d sparklines, eight metric tiles (sleep, steps, HRV, RHR, weight, active kcal, workouts, VO₂ max), inline `ManualEntry` for the day, side-by-side workout + nutrition log forms, and the last 10 workouts. All targets and labels pull from the user's `profiles.targets` so the displayed thresholds match what scoring uses.

## File map (new)

```
lib/scoring/baselines.ts          — rolling RHR/HRV + sleep consistency + strain
lib/domains/health.ts             — upsert/list/rollup + recomputeScoresForDate
lib/db/health-types.ts            — HealthDailyRow / WorkoutRow / NutritionLogRow

app/api/health/route.ts           — GET (list) + POST (upsert) for health_daily
app/api/workouts/route.ts         — GET + POST
app/api/nutrition/route.ts        — GET + POST
app/api/ingest/healthkit/route.ts — bearer-secret-gated iPhone ingress
app/api/settings/targets/route.ts — GET + PATCH profiles.targets
app/api/cron/health-scores/route.ts — nightly recompute (7d window per user)
app/(dashboard)/health/page.tsx   — full dashboard (replaces Placeholder)

components/health/SparkLine.tsx
components/health/MetricCard.tsx
components/health/ManualEntry.tsx
components/health/WorkoutEntry.tsx
components/health/NutritionEntry.tsx

tests/unit/health-baselines.test.ts   — 10 tests
tests/unit/health-validation.test.ts  — 13 tests
tests/unit/health-ingest.test.ts      — 3 tests (in-memory Supabase fake)

docs/phase-5-iphone-health.md     — endpoint contract + Shortcut walkthrough
```

## File map (modified)

```
lib/security/validation.ts        — added healthDailyCreate, workoutCreate, nutritionCreate, healthkitIngest, targetsUpdate
lib/chief/snapshot.ts             — fixed: select(... resting_heart_rate) (was resting_hr — column never existed)
lib/chief/types.ts                — CoHealthDay.resting_heart_rate (was resting_hr)
vercel.json                       — added health-scores cron (09:00 daily)
scripts/run-cron.sh               — accepts `health-scores` job
.env.local                        — HEALTHKIT_INGEST_SECRET placeholder
```

## Setup (≈30 min, only the iPhone side has any real work)

1. **Add the ingest secret.** `openssl rand -base64 32`, paste into `.env.local` as `HEALTHKIT_INGEST_SECRET=…`, restart `npm run dev`.
2. **(Optional) Tune targets.** `PATCH /api/settings/targets` with `{ "steps": 12000, "sleepMinutes": 480, "protein": 160 }` — or just take the defaults. Targets feed every score.
3. **Wire your iPhone.** Follow `docs/phase-5-iphone-health.md` — Option B (Apple Shortcut) takes 30 min and uses no Apple developer account. Run the Shortcut once manually; refresh `/health`; your day appears.
4. **Schedule the nightly recompute.** Vercel: already in `vercel.json`. Self-host: `0 2 * * * /app/scripts/run-cron.sh health-scores`.
5. **Sanity-check via curl.**
   ```bash
   curl -X POST https://<host>/api/ingest/healthkit \
     -H "Authorization: Bearer $HEALTHKIT_INGEST_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"date":"2026-06-10","source":"shortcut","steps":10243,"sleep_minutes":432,"resting_heart_rate":56,"hrv":67}'
   ```
   The response includes the recomputed `recovery_score`, `activity_score`, `nutrition_score`.

## Why this matches the spec exactly

- Schema (§5.6) already in `0007_health.sql` — no migration churn this phase. RLS keyed `user_id = auth.uid()` from `0011` covers the new endpoints; ingest uses service role + shared secret (§7 point 6).
- Scoring (§6) implemented in `lib/scoring/health.ts` (Phase 2) + the new `baselines.ts`. The recompute path takes a real 30d window of rows so HRV/RHR baselines come from the user's data once they have 7+ days.
- iPhone ingest (§12.4) — single endpoint, same JSON, idempotent upsert. Embedded `workouts[]` get fanned into `workouts` rows.
- Done-when gate: "last night's sleep and today's steps show on the dashboard from your phone." → satisfied once you wire the Shortcut and refresh `/health`.

## Bug fixed in flight

`lib/chief/snapshot.ts` was selecting `resting_hr` from `health_daily`, but the column is `resting_heart_rate`. Silently returned `null` until now. Caught while wiring the dashboard.

## What's NOT done in Phase 5

- The Swift HealthKit companion app (Option A). Stub instructions are in `docs/phase-5-iphone-health.md`; build later if you outgrow Shortcuts.
- Multi-device routing for ingest (single-user install resolves the first profile). Once you add a second user, swap in a `(device_id → user_id)` table.
- Live-DB runtime verification (only you have the keys). Build, types, and unit tests pass; real `POST` from your phone is the smoke test.
