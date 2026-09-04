# Step 2 — Telegram Live Test Checklist

Goal: confirm Telegram capture now runs through the canonical OS pipeline
(`runCapturePipeline`) end-to-end, with no regressions. No code changes — send
messages, read replies, inspect the DB.

> **Real table names (important):** this project has **no `notes` table and no
> `embeddings` table.** Note / idea / journal captures live in **`journal_entries`**,
> and memory/embeddings live in **`memory_chunks`** (`text` + `embedding vector(768)`).
> `notes` exists only as a *column* on a few tables. Graph lives in **`entities`** /
> **`entity_relationships`**. Inspect those names, not `notes`/`embeddings`.

## Setup

- **Start the bot:** `cd personal-os-v2 && npm run telegram`
  (needs `TELEGRAM_BOT_TOKEN`, `TELEGRAM_USER_ID`, `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SERVICE_ROLE_KEY` in `.env.local`). **Keep this terminal visible** —
  the pipeline runs in-process, so its logs (`[Alfred] …`, `[audit] …`, `[memory] …`)
  print here.
- **For tests 5 & 9 (/ask, /briefing):** also run `npm run dev` (localhost:3000).
- **Inspect the DB** in Supabase Studio → SQL editor. Note your start time to filter `created_at`.
- **Provider modes** (tests 7 & 8): gateway ON = `AI_PROVIDER=local` + Ollama running
  (or `anthropic`/`openai` + key); fallback = model stopped / key unset.

Verdict per test: ✅ pass / ❌ note what differed.

---

## Tests

**1. Normal task capture**
- Send: `Call the accountant tomorrow`
- Expect: reply "✅ **Task** filed, sir." with the title + quadrant block + buttons.
- Inspect: `tasks` → 1 new row · `raw_ingestion_events` → 1 row with `processing_status='done'`, `routed_to='tasks'`, `routed_id` set.

**2. Eisenhower quadrant assigned**
- Same message as #1.
- Expect: reply shows "📊 <QUADRANT> (NN% confidence)" + a reason line + four quadrant buttons.
- Inspect: that `tasks` row → `quadrant`, `urgency_score`, `importance_score`, `quadrant_confidence`, `quadrant_reason` all populated.

**3. English, not JSON**
- Any capture.
- Expect: butler prose ("…, sir."). No `{`, no `"kind":`, no raw object.
- Inspect: just read the message.

**4. Review / Undo buttons**
- On a task reply tap **↩️ Undo** → expect "Consider it forgotten, sir."
  Inspect: that `tasks` row deleted · `raw_ingestion_events.processing_status='pending'` · `audit_log` → a `delete` row.
- Capture again, tap **🔄 Review** → expect "Set aside for your review, sir."
  Inspect: that `tasks` row deleted · `review_queue` → new `open` row · raw status `needs_review`.

**5. /ask searchability** (web app, not a bot command; needs embeddings)
- Send note: `Note: the warehouse lease renews in March`. Then web → `/insights` → Ask: "warehouse lease".
- Expect: with an embeddings model → answer references the note. Without one → "memory unavailable / no model" (expected, not a failure).
- Inspect: `memory_chunks` → new row(s) with `source_type` + `embedding` (only when a model is configured).

**6. Graph enrichment (works or no-ops, never breaks capture)**
- Send: `Call Sam Rivera at Acme Inc about the renewal`
- Expect: a normal task reply (capture must not fail).
- Inspect: `entities` → new rows (Sam Rivera/person, Acme Inc/company) · `entity_relationships` → a co-mention edge. Graph is best-effort: if it finds nothing it silently no-ops — capture still succeeds. (Errors are swallowed by design, so verify via the `entities` table, not logs.)

**7. AI gateway used when configured**
- Mode: gateway ON. Send: `Pay the electricity bill by next Friday`.
- Expect: `due_date` set to the actual Friday; kind may be richer than regex (e.g. `finance`).
- Inspect: `raw_ingestion_events.classification` (jsonb) → `due_date` populated and `confidence` a "natural" value (e.g. 0.88). Ollama: its `ollama serve` terminal logs the request.

**8. Regex fallback when no LLM**
- Mode: model OFF. Send the same: `Pay the electricity bill by next Friday`.
- Expect: still filed as a task; **`due_date` null** (regex doesn't parse dates — the known Step 2 tradeoff); reply otherwise normal.
- Inspect: `raw_ingestion_events.classification.confidence` = exactly **0.70** (strong) or **0.45** (weak) → confirms `regexClassify` ran. Bot stdout shows no model error blocking capture.

**9. Existing commands**
- `/status` → counts (open tasks, goals, pending reviews, new insights).
- `/matrix` → open tasks grouped Do Now / Schedule / Delegate / Drop.
- `/review` → review-queue items + low-confidence quadrants, each with buttons.
- `/correct last` → most recent task + quadrant buttons; tap one → Inspect: `tasks.user_corrected_quadrant` set · `quadrant_corrections` → new row.
- `/briefing` → needs `npm run dev` + `CRON_SECRET`; expect a briefing message (or a clear "couldn't reach the study" if the dev server is down). Inspect: `ai_insights` rows.

**10. No duplicate records**
- Send ONE message.
- Expect: exactly one reply.
- Inspect: `raw_ingestion_events` → exactly 1 new row · routed table → exactly 1 new row · `audit_log` → 1 `insert` row. The poller calls `deleteWebhook` on start, so the webhook won't also process it — but never run two pollers at once.

---

## Table cheat-sheet

| Table | What to look for |
|---|---|
| `raw_ingestion_events` | every capture: raw text, `processing_status`, `classification` jsonb, `routed_to`/`routed_id` |
| `tasks` / `risks` / `opportunities` / `decisions` / `contacts` / `learning_items` / `journal_entries` | the routed record |
| `review_queue` | low-confidence captures + "send to review" |
| `audit_log` | insert/delete actions (`user_id`, `source`, `table_name`, `record_id`) |
| `memory_chunks` | embeddings (only with a model) |
| `entities` / `entity_relationships` | graph enrichment |
| `quadrant_corrections` | quadrant override / keep presses |
| `ai_insights` | `/briefing` output + `/status` insight count |

Quick query (set your own start time):

```sql
select created_at, source, processing_status, routed_to,
       classification->>'kind' as kind,
       classification->>'confidence' as conf,
       classification->>'due_date' as due
from raw_ingestion_events
order by created_at desc
limit 10;
```

## Two cross-cutting checks while you go
- Watch the bot terminal for `[memory] …` / `[audit] …` lines — none should block a capture.
- After each capture the reply should arrive in 1–2s; a hang usually means the model
  endpoint is unreachable and the gateway is waiting before it falls back to regex.
