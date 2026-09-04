# Sync Health to OS — iPhone Shortcut

Pushes your iPhone's HealthKit data into Personal OS every morning by POSTing to
`/api/ingest/healthkit`. This finishes Phase 5 Option B.

**What's in this folder**

| File | What it is |
|---|---|
| `SyncHealthToOS.plist` | The shortcut, ready to **sign once** on a Mac and import. Asks for your URL + secret at import. |
| `README.md` | This guide — Path A (install the file) and Path B (build by hand, no Mac). |

The shortcut sends this JSON (every field optional except `date`; missing
readings are simply omitted, never an error):

```json
{ "date": "2026-06-21", "source": "shortcut",
  "steps": 10243, "active_energy_burned": 512, "calories_consumed": 2200,
  "protein_grams": 138, "resting_heart_rate": 56, "hrv": 67.2,
  "vo2_max": 47.8, "weight": 82.4, "body_fat_percentage": 17.5,
  "sleep_minutes": 432 }
```

---

## Before anything: make the app reachable from your phone

You picked **"not exposed yet."** The phone needs a URL it can actually reach.
Pick one and note the resulting **base URL**:

| Option | Base URL looks like | Notes |
|---|---|---|
| **LAN (simplest)** | `http://192.168.1.20:3000` | Run `npm run dev` / Docker on your Mac. Phone must be on the **same Wi‑Fi**. Find the IP in System Settings → Wi‑Fi → Details. `http://` is fine — Shortcuts allows plain‑http LAN. |
| **Tunnel** | `https://os.trycloudflare.com` | `cloudflared tunnel --url http://localhost:3000` — works on cellular too, no port‑forwarding. |
| **Vercel** | `https://your-app.vercel.app` | Public HTTPS anywhere. Set `HEALTHKIT_INGEST_SECRET` in Vercel → Settings → Environment Variables. |

Your **ingest URL** = base URL + `/api/ingest/healthkit`.

The secret is already set in your `.env.local` as `HEALTHKIT_INGEST_SECRET`. Use
that exact value when the shortcut asks. (Whatever host you run must have that
same value in its environment.) Quick check from any computer:

```bash
curl -s -X POST "<BASE_URL>/api/ingest/healthkit" \
  -H "Authorization: Bearer <YOUR_SECRET>" -H "Content-Type: application/json" \
  -d '{"date":"2026-06-21","source":"shortcut","steps":1234}'
# expect: {"ok":true,"date":"2026-06-21","recovery_score":...}
# 403 = wrong secret · 503 = secret not set on server · 401/timeout = wrong URL/unreachable
```

---

## Path A — install the prebuilt file (needs a Mac, ~5 min)

iOS 15+ only imports **signed** shortcuts, so sign the plist once on a Mac (the
`shortcuts` CLI ships with macOS — no Xcode needed):

```bash
cd <this folder>
shortcuts sign --mode anyone --input SyncHealthToOS.plist --output SyncHealthToOS.shortcut
```

> `sign` validates against Apple's servers — be signed into iCloud and online, or
> it fails silently. (`-m/-i/-o` are short aliases for the three flags.)

Then:

1. **Get it on the phone** — AirDrop `SyncHealthToOS.shortcut` to your iPhone, or
   drop it in iCloud Drive and tap it. It opens in Shortcuts as an import preview.
2. **Allow untrusted shortcuts** (one‑time): open the Shortcuts app and run any
   shortcut once, then Settings → Shortcuts → enable **Allow Untrusted
   Shortcuts**. Without this, third‑party shortcuts can't be added.
3. **Answer the two import prompts:**
   - *Ingest URL* → your full `<BASE_URL>/api/ingest/healthkit`
   - *Secret* → your `HEALTHKIT_INGEST_SECRET`
4. **Run it once.** Tap the shortcut. iOS asks permission to read Health data —
   tap **Allow** (turn on every category, or just the ones you track). You should
   get a "Health synced ✓" notification; open `/health` to confirm today's row.
5. **Automate 6:30 AM** — see [Automation](#automate-it) below.

> The signed file embeds the actions but **not** your URL/secret — those are
> asked at import, so the same file is safe to reuse or share.

### Verify these 5 fields after first run

HealthKit's picker labels vary slightly by iOS version. After importing, open the
shortcut and glance at each **Find Health Samples** action — if a metric reads 0
or looks wrong, tap it and re‑pick the type / date range:

- **Dietary Energy** (calories_consumed) — may be listed as *Calories*.
- **Heart Rate Variability** (hrv) — confirm it's the HRV/SDNN type.
- **VO₂ Max** (vo2_max) — may render *VO₂ Max*.
- **Body Mass** (weight) — the UI may call it *Weight*.
- **Sleep** (sleep_minutes) — it's summed then ÷60; confirm the number looks like
  minutes (~360–540), not hours.
- Also confirm the cumulative metrics (steps, energy, calories, protein) are
  filtered to **Today** and the point metrics (HR, HRV, VO₂, weight, body fat)
  are **Latest, Limit 1**.

If a field is wrong it doesn't break anything — the server drops blanks and
coerces the rest. Fix it in the editor and move on.

---

## Path B — build it by hand (no Mac, ~15 min, always works)

This produces the exact same result without signing.

1. **Shortcuts app → ➕ New Shortcut**, name it **Sync Health to OS**.
2. **Format today's date.** Add **Date** (gives Current Date) → **Format Date** →
   Date Format = **Custom**, format string `yyyy-MM-dd`.
3. **Read each metric.** For every row below add **Find Health Samples**, set the
   **Sample Type**, then:
   - *Totals* → after Find, tap the filter to set **Date is Today**, then add
     **Calculate Statistics → Sum**.
   - *Latest* → in the Find action set **Sort by Start Date, Order Latest First,
     Limit 1**.

   | Sample Type | Mode | JSON key |
   |---|---|---|
   | Steps | Total, Today | `steps` |
   | Active Energy | Total, Today | `active_energy_burned` |
   | Dietary Energy (Calories) | Total, Today | `calories_consumed` |
   | Protein | Total, Today | `protein_grams` |
   | Resting Heart Rate | Latest | `resting_heart_rate` |
   | Heart Rate Variability | Latest | `hrv` |
   | VO₂ Max | Latest | `vo2_max` |
   | Body Mass (Weight) | Latest | `weight` |
   | Body Fat Percentage | Latest | `body_fat_percentage` |
   | Sleep | Total, Today, ÷ 60 | `sleep_minutes` |

   Tip: rename each result variable (long‑press → Rename) to the JSON key so the
   next step is tidy. For **Sleep**, after the Sum add **Calculate → ÷ 60** to get
   minutes.

4. **POST it.** Add **Get Contents of URL**:
   - URL = `<BASE_URL>/api/ingest/healthkit`
   - Expand **Advanced** → **Method: POST**
   - **Headers** → add `Authorization` = `Bearer <YOUR_SECRET>` (one space after
     Bearer)
   - **Request Body: JSON** → add one field per row:
     - `date` (Text) → the Formatted Date variable
     - `source` (Text) → `shortcut`
     - one **Number** field per metric above → its variable
5. *(optional)* Add **Show Notification** with the **Contents of URL** variable so
   you see the response.
6. **Run once**, allow Health access, confirm on `/health`, then automate ↓.

---

## Automate it

Shortcuts app → **Automation** tab → ➕ → **Time of Day** → **6:30 AM**, Daily →
**Run Immediately** (toggle **Ask Before Running** off) → choose **Sync Health to
OS**.

The nightly `/api/cron/health-scores` job re‑scores the last 7 days, so a late or
missed upload is reconciled by morning anyway.

> Want it **fresher than once a day** — syncing in the background every few
> minutes, or on wake / charge / arrive-home? See
> **[`REALTIME-sync.md`](REALTIME-sync.md)**.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `403 forbidden` | Secret doesn't match the server's `HEALTHKIT_INGEST_SECRET`. |
| `503 healthkit ingest not configured` | Server has no secret set (still the placeholder). |
| `400` | Shouldn't happen — the endpoint now drops blank metrics and coerces stringified numbers. If you see one, the response body names the bad field. |
| Connection error / timeout | Wrong base URL, or phone not on the same network as a LAN host. Try the curl test above from the phone's network. |
| A metric is always 0 | That type returned no sample today — fine (it's omitted). For weight/VO₂/body‑fat use **Latest** so it grabs the most recent reading regardless of date. |
| Date is a day off | The shortcut uses the phone's local date. Keep the phone's timezone correct (yours is Asia/Riyadh, UTC+3, no DST). |

## How it maps to the server

`POST /api/ingest/healthkit` → Bearer‑gated, runs as service role, idempotent
upsert on `(user_id, date)` (re‑posting a day overwrites, never duplicates), then
recomputes recovery/activity/nutrition scores and returns them. Same endpoint as
the future Swift HealthKit app (Option A), so nothing else changes if you upgrade.
