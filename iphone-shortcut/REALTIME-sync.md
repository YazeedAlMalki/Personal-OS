# Real-time(ish) health sync — options

**The honest constraint:** Apple Shortcuts has **no "new health data" trigger**, so
a shortcut can never fire the instant your watch records a reading. And *any*
method — even a custom app — can only read HealthKit while the **iPhone is
unlocked**. So "truly instant, always" isn't achievable on iOS. Here's the
realistic ladder, with the server side already built for the best no-code option.

| Option | How close to real-time | Build effort | Cost |
|---|---|---|---|
| **A. Health Auto Export → adapter** | Background, ~every 5 min (best-effort, when unlocked) | None — I built the server side | Premium app (~$6/yr) |
| **B. Shortcut on event triggers** | When you wake / plug in / get home | None — uses the shortcut you have | Free |
| **C. Swift companion app** | The instant new data lands (still unlocked-only) | Build in Xcode | Free |

You said *real-time without building an app* → **Option A** is the match. I've
added the endpoint it needs; setup is below.

---

## Option A — Health Auto Export (recommended, no coding)

The [**Health Auto Export – JSON+CSV**](https://apps.apple.com/app/id1115567069)
app uses HealthKit background delivery to POST your data to a URL on a cadence
(as low as every 5 min). I built a matching endpoint so its data flows straight
into `/health`:

**New endpoint:** `POST /api/ingest/health-auto-export` — same `Bearer
HEALTHKIT_INGEST_SECRET` as the shortcut, translates the app's JSON into your
`health_daily` upsert, idempotent on `(date)`. Re-posts and batched posts merge
safely (fields it doesn't send are preserved).

### Setup (~10 min)
1. Install the app, open it, **grant Health read access**.
2. **Upgrade to Premium** — the REST API automation is a paid feature (7-day free
   trial; **$5.99/yr** or **$24.99 lifetime**). The cheaper $2.99 tier does *not*
   include automations.
3. **Automations tab → ➕ → Automation Type: REST API.**
4. **URL** = `<BASE_URL>/api/ingest/health-auto-export`
   (e.g. `http://192.168.1.20:3000/api/ingest/health-auto-export` on your LAN, or
   your tunnel/Vercel host — see the host options in `README.md`).
5. **Add Header** → key `Authorization`, value `Bearer <YOUR_SECRET>` (the value
   from `.env.local`). One space after `Bearer`.
6. **Format: JSON.** **Data Type: Health Metrics.** Select exactly these metrics
   (the ones the adapter maps):
   `Steps · Active Energy · Dietary Energy · Protein · Resting Heart Rate · Heart
   Rate Variability · VO₂ Max · Weight & Body Mass · Body Fat Percentage · Sleep
   Analysis`.
7. **Summarize Data: ON** (one value per day — simplest; the adapter also handles
   the un-summarized form).
8. **Sync cadence:** every 5 minutes (or hourly — your call).
9. **Units** don't matter — the adapter normalizes kJ→kcal and lb→kg, and sleep
   hours→minutes, automatically. Send whatever the app defaults to.
10. Save, then tap **Manual Export** once to test → open `/health`; today's row
    should fill in within a few seconds.

### What to expect (read this)
- **Not guaranteed-instant.** iOS runs background tasks opportunistically — a
  5-min cadence is "best-effort," and **nothing syncs while the phone is locked**.
  Keeping the phone on a charger relaxes iOS's limits; adding the app's
  *Automations* widget to your Home Screen helps it run.
- A missed window self-heals: your nightly `health-scores` cron re-scores the last
  7 days, so late data still lands correctly.
- The adapter maps **daily metrics AND individual workouts**: enable *Workouts*
  in the app's export and each session lands in the `workouts` table (type,
  duration, kcal, distance, avg/max HR), rolls up into the day's counters, and
  re-scores the day. Re-posts are deduped (each workout's start time is its
  identity, kept in `notes` as `hae:…`), so the 5-min window re-export never
  duplicates rows.

---

## Option B — free, event-driven freshness (no extra app)

Keep the shortcut you already have and trigger it at natural moments instead of
once at 6:30. In the Shortcuts app → **Automation** tab → ➕, set any of these to
**Run Immediately** → run **Sync Health to OS**:

- **When I wake up** (or Sleep Focus turns off) → captures last night's sleep right away.
- **Charger Connected** → syncs whenever you plug in (often post-workout / bedtime).
- **Arrive home** (location) → a fresh sync when you walk in.
- **When I open Health / Fitness** (App automation) → sync whenever you check rings.

You can stack several — each is free and needs no purchase. Not instant-on-new-
data, but it keeps the OS current through the day without paying for anything.

---

## Option C — true instant (build the Swift app)

The only way to POST *the moment* a sample is written is a tiny HealthKit
companion app using `HKObserverQuery` + `enableBackgroundDelivery` (the "Option A"
in `docs/phase-5-iphone-health.md`). It hits the same `/api/ingest/healthkit`
endpoint, so nothing server-side changes. It's free but needs Xcode + a Mac, and
is still bound by the unlocked-device rule. I can build it if you want to go there.
