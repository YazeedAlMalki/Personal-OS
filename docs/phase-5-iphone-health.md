# Phase 5 — wire your iPhone into Personal OS

Two paths, **same endpoint** (`POST /api/ingest/healthkit`), so the choice is
purely about how rich a sync you want. Both write to `(user_id, date)` and are
idempotent — re-posting the same day overwrites; it never creates duplicates.

## Endpoint contract

```http
POST /api/ingest/healthkit
Authorization: Bearer <HEALTHKIT_INGEST_SECRET>
Content-Type: application/json

{
  "date": "2026-06-10",
  "source": "shortcut",                // or "healthkit"
  "steps": 10243,
  "sleep_minutes": 432,
  "sleep_start": "2026-06-09T23:14:00Z",
  "sleep_end":   "2026-06-10T06:26:00Z",
  "resting_heart_rate": 56,
  "hrv": 67.2,
  "vo2_max": 47.8,
  "active_energy_burned": 512,
  "weight": 82.4,
  "body_fat_percentage": 17.5,
  "calories_consumed": 2200,
  "protein_grams": 138,
  "workouts": [
    { "workout_type": "run", "duration_minutes": 32, "calories_burned": 310 }
  ]
}
```

All fields except `date` are optional — send whatever you have. Unknown fields
are ignored. The endpoint returns the freshly-recomputed scores so you can show
them on the device if you want.

## Option B — Apple Shortcuts (recommended first step)

> **A finished, prebuilt shortcut + a precise step-by-step now live in
> [`../iphone-shortcut/`](../iphone-shortcut/README.md).** Use that — it ships a
> ready-to-sign `SyncHealthToOS.plist` (asks for your URL + secret at import) and
> a no-Mac manual recipe. The outline below is the original sketch.

1. **Set the secret.** On your server, set `HEALTHKIT_INGEST_SECRET=…` to a
   long random string. Keep it private — it's the only auth gate.
2. **New Shortcut.** Shortcuts → ➕ → name it "Sync Health to OS".
3. **Find Health Sample** actions, one per metric you want:
   - Steps (today) → sum
   - Sleep Analysis (last night) → total minutes
   - Resting Heart Rate (today) → average
   - Heart Rate Variability (today) → average
   - Active Energy (today) → sum
   - Body Mass (latest)
4. **Dictionary** action to build the body. Add `date` (today's date formatted
   `yyyy-MM-dd`), `source: shortcut`, and one key per metric.
5. **Get Contents of URL.**
   - Method `POST`
   - URL: `https://<your-host>/api/ingest/healthkit`
   - Headers:
     - `Authorization: Bearer <HEALTHKIT_INGEST_SECRET>`
     - `Content-Type: application/json`
   - Request Body: JSON → the Dictionary from step 4.
6. **Automation.** Settings → Automation → Personal Automation → Time of Day →
   say 06:30 daily → Run Shortcut → "Sync Health to OS" → Run Immediately.

> Some metrics (HRV, VO₂ max) can be flaky to read from Shortcuts. Skip the
> ones that don't return cleanly — the score formulas degrade gracefully when
> a field is missing.

## Option A — Swift HealthKit companion app

Use this once you outgrow Shortcuts (need richer sleep stages, near-real-time
sync, multi-day backfill).

1. New Xcode project, **Single View App** target. Add the **HealthKit**
   capability.
2. In `Info.plist`, add a string for *NSHealthShareUsageDescription*.
3. Request read permission for: `stepCount`, `sleepAnalysis`, `restingHeartRate`,
   `heartRateVariabilitySDNN`, `activeEnergyBurned`, `workoutType`,
   `bodyMass`, `bodyFatPercentage`, `vo2Max`.
4. `HKObserverQuery` per type → on update, aggregate the current day → POST to
   `/api/ingest/healthkit` with the same `Authorization: Bearer …` header.
5. Schedule a `BGAppRefreshTaskRequest` once per day to backstop the observers.
6. For backfill, build an `HKStatisticsCollectionQuery` over the last 90 days
   and POST one body per day — the upsert handles dedup.

The endpoint is identical in both cases, so nothing else in Personal OS
changes when you switch.

## Verifying it worked

After your first sync, open `/health` — today's row populates, the three
score tiles fill in, and the 14-day sparklines extend by one segment. The
nightly `/api/cron/health-scores` job re-scores the last 7 days, so any
upload that arrives late will be reflected by morning.
