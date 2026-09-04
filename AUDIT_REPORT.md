# Personal OS V2 — Code Audit (2026-06-11)

> ## ✅ RESOLVED — pending migrations applied live (2026-06-11, late)
>
> Live verification had discovered migrations **0012/0013/0014 were never applied** to
> project `vlcuxecybxfvxeygsryk`. Claude ran `supabase/APPLY_PENDING.sql` through the
> dashboard SQL editor (user's Chrome session) → "Success. No rows returned" → REST
> verification PASS on all three (quadrant columns, `quadrant_corrections`, decision
> outcome columns). **Live DB is now at full schema 0001–0014.** The 6 pre-existing
> tasks were then backfilled via `scripts/backfill-quadrants.ts` (6/6 scored).
> Nothing is outstanding on the database. Remaining user-side extras (all optional):
> iPhone Shortcut, `STT_PROVIDER=openai` + key, `CALENDAR_ICS_URL`, Ollama for local AI.

> ## ✅ Live verification pass — evening (2026-06-11)
>
> Executed against the REAL Supabase project from the sandbox:
>
> - **Crons live: 6/6 green over GET** (the Vercel method) — forecast persisted 5 insights,
>   sweeps 10, analytics 1, health-scores rescored 7 days, data-quality scored 31 records,
>   graph-importance clean no-op (entities empty until seed). The B1 fix is proven end-to-end.
> - **RLS live: 36/36 isolation checks pass** via REST with two throwaway users (created +
>   deleted, cascade verified, zero residue): cross-user reads blocked, cross-user deletes
>   affect 0 rows, `user_id` forgery rejected by WITH CHECK, anon sees nothing, profiles
>   scoped, `match_memory_chunks` RPC user-scoped — across tasks, goals, journal, contacts,
>   decisions, finance, health.
> - **`/api/health-check` live**: public 200, `db:ok`, honest `ai:unavailable` (no Ollama in sandbox).
> - **npm: 0 vulnerabilities** (was 2 moderate prod + a critical dev chain). postcss override
>   `^8.5.10` (+ direct dep aligned) clears the Next advisory; vitest bumped 2→3.2.6 clears
>   vitest/vite/esbuild. Re-verified after: `tsc` ✓, **215/215 tests on vitest 3** ✓,
>   `next build` ✓ 80 routes. (`npm install` works in the mounted folder now — the old EPERM
>   note is obsolete.)

> ## ✅ Remediation pass — same day (2026-06-11)
>
> Everything below was found in the morning audit; the afternoon session **fixed all bugs
> and built all missing features**. Verified after: `tsc` clean · `vitest` **215/215**
> (TZ test root-caused and fixed — calendar-day comparison in `lib/scoring/util.ts`) ·
> `next build` **80 routes** (was 56).
>
> - **B1–B4 fixed**: GET handlers on all 8 cron routes (Vercel Cron compatible), `sendMessage`
>   checks `res.ok`, user text HTML-escaped in Telegram replies, `/api/health-check` public +
>   reports `AIProvider.health()`.
> - **S1, S2, S5 fixed**: size-capped body reads on telegram/healthkit (1MB) + import (50MB);
>   `crypto.timingSafeEqual` comparisons everywhere a secret is checked; login audit row.
>   **S4 built**: TOTP MFA — enroll/disable in /settings, AAL2 challenge at login.
> - **Dead code resolved**: `serverEnv()` now wired into `createServiceClient()` (env validated,
>   schema un-drifted: STT/HealthKit/calendar/model keys added); `telegram-poller.ts` deleted.
> - **Latent bug fixed**: capture pipeline now threads an explicit `userId` for service-role
>   callers (Telegram webhook) — raw/review/structured/memory inserts no longer rely on
>   `auth.uid()` defaults that are NULL under service role.
> - **Missing features built**: 6 module pages (decisions, CRM, journal, finance, learning,
>   calendar) with CRUD APIs + zod + audit; `/api/time-logs`; **memory spine** (captures and
>   journal entries embed into `memory_chunks`, best-effort) + `/api/memory/search` +
>   **`/api/ask` RAG** (+ Ask panel on /insights; `answer()` on all 4 AI adapters); **STT
>   adapter** (`STT_PROVIDER=openai` → Telegram voice → transcript → pipeline; degrades to
>   review-queue parking); **ICS calendar sync** (`CALENDAR_ICS_URL`/`GOOGLE_CALENDAR_ICAL_URL`,
>   no OAuth) with parser tests.
> - **S6 (npm audit, 2 moderate)**: not auto-fixed — run `npm i next@latest` (15.x patch, or
>   16.2.9 major) on your machine; sandbox can't npm-install into the mounted folder.
> - Deliberately deferred: Google Sheets finance auto-pull (manual snapshots + `/api/finance`
>   cover the module; Sheets needs OAuth), local whisper.cpp STT (`STT_PROVIDER=local` reserved).
>
> Remaining completion: **8-phase plan ≈100% code-complete · full spec ≈95%** (Sheets pull,
> local STT, streaming /api/ask are the residue). Live-DB items still on you: run the RLS
> suite, redeploy, iPhone Shortcut.

---

## Original audit findings (morning) — all addressed, kept for the record

Scope: full repo (~13.8k LOC TS, 40 API routes, 14 migrations, 22 test files).
Verified in sandbox: `tsc --noEmit` ✓ clean · `vitest run` 194/195 (1 known TZ test) · `npm audit` 2 moderate.

**Completion: ~92% of the 8-phase build plan · ~75% of the full architecture spec.**

---

## 1. Bugs

### B1 — HIGH · All 8 Vercel crons will fail with 405
`vercel.json` schedules 8 jobs, but **Vercel Cron invokes paths with GET** and every
`app/api/cron/*/route.ts` exports only `POST`. In a Vercel deploy, briefing, sweeps,
forecast, analytics, health-scores, graph-importance, data-quality and backup never run.
(This matches the "crons unverified" note — they'd fail on first fire.)
**Fix (per route):**
```ts
export async function GET(request: Request) { return POST(request); }
```
(Vercel sends `Authorization: Bearer ${CRON_SECRET}` automatically, so existing auth keeps working. `scripts/run-cron.sh` self-host path is unaffected.)

### B2 — MED · `sendMessage` swallows Telegram API failures
`lib/integrations/telegram.ts:39-55` — no `res.ok` check (unlike `getUpdates`). Combined
with B3 below, failed replies vanish silently. The architecture explicitly calls out
"V1 bug #3 lesson: never swallow a failed POST".

### B3 — MED · Unescaped user text sent with `parse_mode: "HTML"`
`app/api/telegram/webhook/route.ts:96` interpolates `result.classified.title` (user input)
into HTML. A captured title containing `<`, `>` or `&` makes Telegram reject the message
(400) — and B2 hides it. Escape `& < >` before interpolating.

### B4 — LOW · `/api/health-check` unusable as an external liveness probe
Middleware doesn't exempt it, so unauthenticated monitors get a 307 → /login. Spec §10
also wants `AIProvider.health()` included; only DB is checked.

### B5 — KNOWN · `eisenhower-score.test.ts` "due today → 90" fails in UTC sandboxes
Pre-existing, documented in CONTINUE_HERE.md. Fix by injecting a clock/timezone into
`scoreUrgency` instead of relying on machine TZ.

## 2. Security

No criticals. Architecture fundamentals are solid and verified:

- ✅ RLS enabled on **all 26 tables** with owner policies (24 in the 0011 loop + profiles + quadrant_corrections in 0012); 288-line RLS test suite + `scripts/run-rls-tests.sh` present.
- ✅ Middleware auth gate on every page/API except the 3 secret-gated ingress prefixes.
- ✅ Service-role client is `server-only`, never imported client-side (verified imports).
- ✅ Ingress hardening: rate limit **before** secret check, placeholder-secret guard (503), silent sender reject on Telegram, UUID-regex on `[id]` params, Zod on every body.
- ✅ No secrets in docs/markdown; `.gitignore` covers `.env*`; no `dangerouslySetInnerHTML`/`eval`.

Findings (ordered by priority):

| # | Sev | Finding | Where / Fix |
|---|-----|---------|-------------|
| S1 | MED | No request body size cap on unauthenticated ingress (`/api/telegram/webhook`, `/api/ingest/healthkit`) or `/api/import`. Spec §13 requires a payload cap. Vercel caps bodies at ~4.5MB, but self-host (Docker) is unbounded → memory DoS. | Check `content-length` before `request.json()`; reject > 1MB (ingress) / configurable (import). |
| S2 | LOW | Secret comparisons use `!==` (timing side-channel) in cron/telegram/healthkit auth. Rate limiting mitigates. | `crypto.timingSafeEqual` on length-padded buffers. |
| S3 | LOW | Rate limiter is in-process; on serverless every cold instance gets fresh buckets, so brute-force throttling is per-instance only. Documented in the file; spec wanted Upstash/Postgres for cloud. | Acceptable for single-user; swap store if exposed publicly. |
| S4 | LOW | TOTP MFA is "locked" in spec §13/§17 but absent (email+password only). | Supabase `auth.mfa` enroll/challenge flow on a settings page. |
| S5 | LOW | No `audit_log` row on login (spec lists `login` action; the enum supports it) and no app-side rate limit on auth attempts (Supabase's own limits apply). | Log post-login server-side; optional limiter on `/login` POST origin. |
| S6 | LOW | `npm audit`: 2 moderate vulns via Next 15.5.18's bundled postcss range. | Bump `next` to latest 15.x patch. **Do not** run `npm audit fix --force`. |
| S7 | INFO | `/api/ingest/healthkit` & Telegram webhook resolve "first profile" as target user — fine single-user; per-device tokens already noted in code for multi-user. | — |

## 3. Dead code

| What | Evidence | Action |
|------|----------|--------|
| `lib/config.ts` — `serverEnv()` zod validation | **Never imported anywhere**; all code reads `process.env` directly with `!`. Schema also drifted: `.env.local` has `STT_PROVIDER`, `LOCAL_CHAT_MODEL`, `LOCAL_EMBED_MODEL`, `HEALTHKIT_INGEST_SECRET`, `TELEGRAM_*`… not all in the schema. | Wire `serverEnv()` into `lib/supabase/*` + ingress routes (restores fail-fast on misconfig), or delete. |
| `lib/integrations/telegram-poller.ts` (140 LOC) | Superseded by the standalone `scripts/telegram-poll.ts`; only referenced in one comment. Two diverging poller implementations is a maintenance trap. | Delete (keep the script). |
| `components/ui/Placeholder.tsx` | Live by design (6 stub pages) — not dead. | Keep until §4 pages built. |

False positives checked: `lib/eisenhower/{score,types,classify}.ts` are re-exported via `index.ts` — in use.

## 4. Missing features

**Vs the 8-phase plan (§14) — what keeps it from 100%:**

1. **Phase 3 partial — voice never becomes a task.** Voice notes are parked as `needs_review` ("awaiting transcription"); the §12.2 STT adapter was never built. Phase 3's "done when" (voice note → task) is unmet. Text capture ✓.
2. **Phase 4/7 operational gap** — intelligence crons all 405 on Vercel (B1) until fixed; briefing/sweeps/forecast only run via `scripts/run-cron.sh` self-host.
3. **Phase 8 deltas** — distributed rate limiting (S3), payload caps (S1), export writes `storage_path: null` (no Storage copy; GitHub push covers off-site), demo-mode `clearDemo` matches on `title` prefix only.

**Vs the full architecture spec (deferred scope, in spec order):**

| Area | Spec'd | Status |
|------|--------|--------|
| `/api/ask` RAG Q&A over memory (§10) | The flagship "ask your OS anything" read path | ❌ absent |
| `/api/memory/search` vector search route (§10) | `match_memory_chunks` RPC **exists** in 0010 — just no route/UI | ❌ absent |
| Module pages: finance, journal, learning, calendar, crm/contacts, decisions | 6 of 17 dashboard pages are `Placeholder` | ❌ stubs (tables + RLS exist) |
| CRUD routes: `/api/decisions`, `/api/contacts`, `/api/time-logs`, `/api/journal`, `/api/finance`, `/api/learning` (§10) | Schema ready | ❌ absent |
| Google Calendar read-only (§12.5), Google Sheets finance (§12.6) | `calendar_events_cache` / `finance_snapshots` tables ready | ❌ absent |
| STT adapter (§12.2) | `STT_PROVIDER` env exists | ❌ absent |
| TOTP MFA (§13) | locked decision | ❌ absent |
| Crons `finance-snapshot`, `reembed` (§10) | superseded by the 8 implemented crons | ❌ absent |

Fully delivered: schema 26 tables+RLS ✓ · capture pipeline + review queue + AI gateway (4 providers, regex fallback) ✓ · Telegram text capture (webhook + Alfred poller) ✓ · Chief of Staff + persisted insights + briefing ✓ · health module + HealthKit ingest + scoring ✓ · graph (Cytoscape, importance scoring, nightly re-score) ✓ · forecasting engine (11 forecast emitters, surfaced on 5 module pages + insights) ✓ · export/import round-trip + GitHub backup ✓ · Eisenhower matrix ✓ · demo mode ✓ · 195 tests.

## 5. Completion scorecard

| Phase | Score | Notes |
|-------|------:|-------|
| 1 Foundation | 100% | 26 tables, RLS verified, auth, CRUD |
| 2 Capture | 100% | pipeline, gateway, review queue, audit |
| 3 Telegram | 70% | text ✓, voice parked (no STT) |
| 4 Intelligence | 90% | built; cron 405 in cloud (B1) |
| 5 Health | 95% | code ✓; iPhone Shortcut wiring pending (user-side) |
| 6 Graph | 100% | extraction, scoring, view, panel |
| 7 Forecasting | 100% | engine + config + surfaced |
| 8 Hardening | 85% | RLS suite ✓, export/import ✓; S1/S3, storage export |
| **8-phase plan** | **≈92%** | |
| **Full architecture spec** | **≈75%** | ask/RAG, 6 module UIs, 2 Google integrations, STT, MFA outstanding |

## 6. Recommended fix order

1. B1 cron GET handlers (8 × 1 line) — unblocks the entire intelligence layer on Vercel.
2. B3+B2 Telegram HTML escape + `res.ok` check (~10 lines).
3. S1 body-size caps on the 3 unauthenticated/heavy routes (~10 lines).
4. Wire `serverEnv()` (or delete `lib/config.ts`); delete `telegram-poller.ts`.
5. Bump Next patch (clears npm audit).
6. Then features by value: `/api/memory/search` + `/api/ask` (RPC already in DB), decisions page (schema + sweeps already live), STT adapter.
