# Connecting finance to Personal OS — plan

_Written 2026-09-02. Updated 2026-09-03: implementation built, see "What's built now" below — blocked only on your Google service-account credentials to go live._

## What's built now (2026-09-03)

The code is written and passing `tsc`/build/tests, sitting in the repo waiting on credentials:

- `lib/domains/finance-sheet.ts` — pure parsing (`parseAllTabs`, ported from
  V1's `exceljs` logic) + the deterministic extractor
  (`extractSnapshotDeterministic`): scans every tab (preferring one whose
  name looks like "Summary"/"Overview"/"Net Worth"/"Dashboard") for labeled
  rows and reads the adjacent numeric cell — no AI call anywhere in this
  file. No `server-only` import, so it's unit-tested directly (6 tests in
  `tests/unit/finance-sheet.test.ts`, covering a clean summary tab, deriving
  net worth from assets − liabilities when it's not stated directly,
  flagging a sheet where the numbers don't reconcile, an unrecognizable
  sheet, tab preference, and currency-formatted strings like `"$125,000.50"`).
- `lib/domains/finance-sheet-sync.ts` — the `server-only` half:
  `downloadSheetAsXlsx()` (service-account JWT → Drive export, ported from
  V1), and `runFinanceSnapshot()`, which ties it together: pull → parse →
  extract → if confidence ≥ 0.6 and a net worth was found, upsert into
  `finance_snapshots` via the existing `upsertFinanceSnapshot()` with
  `source: "gsheet"`; otherwise park a `review_queue` item
  (`reason: "low_confidence_finance_extraction"`) instead of guessing — same
  P3 pattern the capture pipeline already uses.
- `app/api/cron/finance-snapshot/route.ts` — same GET/POST-wrapping,
  `CRON_SECRET`-gated pattern as the 8 existing crons. Returns 503 with
  `{status:"not_configured"}` until the Google env vars are set, so it's
  safe to deploy now — it just no-ops.
- `vercel.json` — added `/api/cron/finance-snapshot` on `0 5 * * *` (daily,
  Hobby-plan-compatible).
- `googleapis` + `exceljs` added to `package.json` (matches V1's choices).
  `npm audit fix` was run (non-force, per the project's own rule) and
  cleared 4 of 7 pre-existing vulnerabilities; the remaining 3 (1 low, 2
  moderate — a Windows-only esbuild dev-server issue and a uuid buffer-check
  issue in exceljs's dependency tree) need `--force` to clear and would
  downgrade exceljs to a breaking version, so left as-is.
- Full `tsc --noEmit`, `next build`, and `vitest run` (287 tests, up from
  281) all pass with these changes in.

**What this means:** the plumbing is done and tested against synthetic
data. It has never touched a real Google Sheet — that's the one thing
blocked on you (see below). The label-matching regexes in
`FIELD_PATTERNS` (`lib/domains/finance-sheet.ts`) are a best guess at
common sheet wording ("Net Worth", "Total Assets", "Total Liabilities",
"Cash", "Investments", "Income", "Expenses") — they may need tuning once
they see your actual sheet's labels.

## What's already there

`finance_snapshots` (migration `0008_finance_learning.sql`) is a real,
finished table: `assets`, `liabilities`, `net_worth`,
`income_month_to_date`, `expenses_month_to_date`, `investment_value`,
`cash_balance`, `currency`, `source` (`manual | gsheet | import`), one row
per `(user_id, date)`. `GET/POST /api/finance` (`lib/domains/finance.ts`)
is live and working — manual entry today, upsert-safe. The `finance` page
exists in `app/(dashboard)/finance`.

What's missing is the automatic feed: the architecture doc (§12.6) always
called for a **read-only Google Sheets pull**, and the audit report
explicitly deferred it ("Sheets needs OAuth"). It was never built in V2.

## The V1 prototype already solved the hard part — and shows the tradeoff

The old build (`Documents/Claude/personal-os/app/api/finance/snapshot/route.ts`)
has a working version of this: a cron-gated route that
1. pulls the sheet via a Google service account (`google.auth.JWT`,
   `drive.readonly` scope, exports the Sheet as .xlsx),
2. parses every tab into raw rows with `exceljs`,
3. **hands the raw tabs to Claude** with a prompt asking it to find net
   worth / assets / liabilities / categories and return structured JSON,
4. writes the result into that day's snapshot row.

That's a good pattern for the plumbing (Google auth, tab parsing) but it
leans on a cloud LLM call for the extraction step — which conflicts with
Personal OS V2's own design rule (`P1` in the architecture doc): **the
deterministic core must work with zero LLM.** It also happens to run into
the exact gap already flagged: production `AI_PROVIDER` isn't pointed at a
hosted model right now, so porting V1's route as-is would silently degrade
until that's fixed.

## Recommended approach: deterministic-first, AI as optional enrichment

1. **Reuse the plumbing, not the AI dependency.** Port
   `downloadSheetAsXlsx()` and `parseAllTabs()` from V1 — that part is pure
   mechanics (service account → Drive export → xlsx → rows), no model
   involved, and can be dropped into `lib/domains/finance.ts` almost as-is.
2. **Pick (or ask you to define) a fixed "Summary" tab layout** — a small
   set of named cells or a fixed row/column layout for net worth, assets,
   liabilities, income, expenses, cash. A plain function reads those cells
   directly. This is the P1-consistent path: it works with zero AI, same
   as every other domain in this system, and it's exactly the kind of thing
   the existing `AIProvider` gateway was built to *not* be required for.
3. **Only if the sheet is genuinely messy/unstructured**, fall back to the
   existing `AIProvider.answer()`/classify interface (the same swappable
   gateway health/capture already use) to extract a snapshot from the raw
   tabs — gated the same way review-queue writes are: if confidence is low
   or the shape doesn't validate against `financeSnapshotCreate`, write a
   `review_queue` item instead of a bad snapshot, never silently guess.
4. **New cron: `/api/cron/finance-snapshot`.** Same GET/POST pattern as the
   8 existing crons (the B1 fix — `GET` calls `POST`, `CRON_SECRET` bearer
   auth), added to `vercel.json`. Since the account is on Vercel Hobby
   (daily-only cron schedules, per the constraint already hit with
   `sweeps`), run it once daily, e.g. after market close.
5. **Upsert through the existing path** — `upsertFinanceSnapshot()` already
   does the `(user_id, date)` upsert with `source: "gsheet"`; the new cron
   just needs to call it with the parsed/extracted fields.

## What's still needed from you — the only remaining blocker

1. **A Google Cloud service account** (JSON key), with your finance Sheet
   shared to its email address, **read-only**. Steps: Google Cloud Console →
   new project (or reuse one) → enable the Drive API → Credentials → Create
   Service Account → Keys → Add Key (JSON) → open your Sheet → Share → paste
   the service account's `...@...gserviceaccount.com` email in as Viewer.
2. **Three values from that JSON key**, to set as env vars (in `.env.local`
   locally and in the Vercel dashboard for prod):
   - `GOOGLE_SERVICE_ACCOUNT_EMAIL` — the `client_email` field
   - `GOOGLE_SERVICE_ACCOUNT_KEY` — the `private_key` field (keep the
     `\n`s — the code un-escapes them)
   - `GOOGLE_SHEETS_FINANCE_ID` — the long ID in the Sheet's URL between
     `/d/` and `/edit`
3. **A look at your actual sheet's labels** — either paste me the row
   labels from whatever tab has your net worth/assets/liabilities (not the
   numbers, just what each row is called), or tell me to try it against the
   real sheet once the env vars are set, and I'll tune `FIELD_PATTERNS` from
   whatever it fails to match.

## Order of work from here

1. You: do steps 1-2 above, hand me the three values (or set them directly
   in `.env.local` + Vercel yourself if you'd rather not paste a private
   key into chat).
2. Me: set the env vars, run the cron route manually (`curl` with
   `Authorization: Bearer $CRON_SECRET`) against your real sheet, check
   what it extracts, tune the label patterns against whatever it misses.
3. Once a real run writes a correct snapshot, it's live — the daily cron
   takes over from there.
