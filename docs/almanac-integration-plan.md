# Almanac ↔ Personal OS integration plan

_Written 2026-09-02. Almanac is a planned app (not yet built) that will sync
HealthKit, fitness, and other metrics, and sync with Personal OS. This
supersedes the manual iPhone-Shortcut HealthKit sync (paused — see
`personal-os-v2-status.md` in project memory)._

## The contract already exists — reuse it, don't rebuild it

Personal OS V2 already has exactly the endpoint Almanac needs:
`POST /api/ingest/healthkit` (`app/api/ingest/healthkit/route.ts`). It:

- Is a public, secret-gated endpoint (`HEALTHKIT_INGEST_SECRET` as a bearer
  token) — built for exactly this case: a client with no Supabase session.
- Runs as service role, resolves to the single profile (single-user install).
- Validates against `healthkitIngest` (zod, `lib/security/validation.ts`) —
  tolerant of Apple-Shortcuts-style payloads (empty strings, stringified
  numbers) but the shape is a clean JSON contract any client can hit.
- Upserts idempotently on `(user_id, date)` into `health_daily`, and inserts
  rows into `workouts[]` — partial/overlapping posts merge, they don't clobber.
- There's already a second adapter, `lib/domains/health-auto-export.ts`, that
  maps a *different* wire format (Health Auto Export's) onto the same
  `HealthkitIngest` shape. That's the template: Almanac gets its own thin
  mapper if its native export shape differs, everything downstream
  (scoring, forecasting, Chief of Staff) is already wired and doesn't change.

So step 1 is not "build a new integration" — it's "point Almanac at this URL
with this token and this JSON shape," the same way the Shortcut would have.

## What to change before Almanac ships

1. **Give Almanac its own secret, don't share `HEALTHKIT_INGEST_SECRET`.**
   Right now there's one shared token gating the endpoint. Once there are two
   independent clients (a future Shortcut/Health Auto Export path + Almanac),
   they should be independently revocable and attributable. Cheapest fix:
   add a small `ingest_devices` table (`id`, `user_id`, `name`, `token_hash`,
   `source_label`, `created_at`, `last_seen_at`) and check the presented
   token against it instead of a single env var. `source` on `health_daily`
   already has a free-text column — add `'almanac'` as a value alongside
   `healthkit | shortcut | manual`.
2. **Nutrition already has a home.** `nutrition_logs` (meal_name, calories,
   protein, carbs, fat, `ingredients jsonb`) is unused by any ingest path
   today — only the manual UI writes to it, if that page is even built out.
   Given the `ALManac-food-data` folder already on your machine, Almanac's
   food logging is the natural first writer here. Extend the healthkit
   ingest schema (or add a sibling `almanac` field) to accept an optional
   `meals[]` array mapped onto `nutrition_logs`, same upsert-friendly pattern.
3. **Decide the sync direction(s).** The ingest endpoint only covers
   Almanac → Personal OS. If Almanac should also *read* from Personal OS
   (e.g. show today's task load next to today's recovery score, or read a
   calorie/steps target you set in Personal OS's `targets` table) that's a
   second, separate contract — a small read-only API keyed by its own token,
   scoped to just the fields Almanac needs. Don't build this until Almanac
   actually needs it; the write path alone gets you 90% of the value
   (Personal OS becomes the system of record, Chief of Staff/forecasting see
   real health data).
4. **Confirm the payload shape with Almanac's actual export format** once
   that's decided (raw HealthKit JSON vs. a custom Almanac schema) — write
   the mapper the same way `health-auto-export.ts` does, keep it a pure
   function so it's unit-testable without hitting the network.

## Suggested order of work (when Almanac is far enough along to test against)

1. Add the `ingest_devices` table + migration, swap the single-secret check
   for a per-device token lookup (touches only `app/api/ingest/healthkit/route.ts`).
2. Add `meals[]` handling to the ingest schema + a `mapAlmanacExport()`
   adapter once Almanac's export shape is known.
3. Point Almanac's sync job at `https://personal-os-v2-six.vercel.app/api/ingest/healthkit`
   with its device token.
4. Only if needed later: a scoped read API for Almanac to pull targets/context back.
