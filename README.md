# Personal OS V2

A private, single-user personal **intelligence** platform — not just a dashboard. It captures, organizes, scores, forecasts, and challenges your decisions across tasks, goals, health, finance, relationships, opportunities, decisions, and risks.

Full design: **`../Personal-OS-V2-Architecture.md`**. This repo is the implementation, built phase by phase.

> **Status: ALL 8 PHASES COMPLETE + audited & hardened (2026-06-11)** — `tsc` clean, 215 unit tests, `next build` 80 routes. See `AUDIT_REPORT.md`.
> - **Phases 1–8** — schema+RLS (26 tables), capture pipeline + AI gateway, Telegram (text + voice-with-STT), Chief of Staff + briefing, health, graph, forecasting, hardening (export/import, rate limits, body caps, timing-safe secrets, RLS suite).
> - **Beyond the phases** — all module pages live (decisions, CRM, journal, finance, learning, calendar w/ ICS sync); memory embeddings + `/api/memory/search` + `/api/ask` RAG; TOTP MFA; login audit.
> - **Your machine only**: apply migrations, run `scripts/run-rls-tests.sh`, optionally set `STT_PROVIDER=openai`, `CALENDAR_ICS_URL`, and bump `next` (`npm audit` shows 2 moderate in the bundled postcss).
>
> First run: paste your keys into `.env.local`, run `supabase/all_migrations.sql`, then `supabase/seed.sql` for demo data. Steps in `SESSION_LOG.md`.

## Design contract (don't break these)

- **LLM-optional core** — all scores/forecasts/alerts are deterministic. The model only transcribes, classifies, extracts, summarizes, answers. Never load-bearing for correctness.
- **Capture never loses data** — raw input is persisted before processing.
- **Confidence-gated writes** — low-confidence extractions become review items, not silent rows.
- **Private by default** — RLS on every table, predicate `user_id = auth.uid()`.

---

## Prerequisites

- **Node 20+** and npm
- A **Supabase project** (free cloud tier is fine to start) — for Postgres + Auth + pgvector
- **Ollama** (for Phases 2+) with a chat model and the embedding model:
  ```bash
  ollama pull llama3.1:8b
  ollama pull nomic-embed-text
  ```
- *(Optional)* **Docker** — for the self-host `docker compose` topology

---

## Setup

### 1. Create the Supabase project
1. Create a project at supabase.com.
2. **Project Settings → API**: copy the **Project URL**, the **anon** key, and the **service_role** key.
3. **Database → Extensions**: enable **`vector`** (and `pg_trgm`) — or just run migration `0001`, which enables them.
4. **Authentication → Providers → Email**: enable Email. For a private single-user setup, you may turn **"Confirm email" off** so you can log in immediately (or create your user under **Authentication → Users**).

### 2. Configure env
```bash
cp .env.example .env.local
# fill NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
# set USER_TIMEZONE (e.g. Europe/Riyadh)
```

### 3. Run the migrations
Apply everything in `supabase/migrations/` **in filename order**. Two options:

- **Supabase SQL editor:** paste each file `0001 → 0011` in order and run.
- **Supabase CLI:**
  ```bash
  supabase link --project-ref <your-ref>
  supabase db push
  ```

This creates all 25 tables, indexes, triggers, the vector-search function, and RLS policies on every table.

### 4. Install & run
```bash
npm install
npm run dev          # http://localhost:3000
```
Visit `/login`, sign in (or sign up) with the email/password you created, and you'll land on the dashboard. Create a task under **Tasks** — RLS guarantees only you can read it.

### 5. (Optional) Self-host with Docker
```bash
docker compose up -d
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull nomic-embed-text
```

---

## Project structure (Phase 1)

```
app/
  (dashboard)/          authed shell: layout + Today + module pages
  login/  signup/       email+password auth
  api/                  tasks / goals / projects CRUD + health-check
lib/
  config.ts             zod-validated env
  supabase/             browser / server / service clients (@supabase/ssr)
  domains/              tasks, goals, projects services
  security/             validation (zod), audit
supabase/migrations/    0001–0011 (schema + RLS)
tests/                  RLS + unit stubs
middleware.ts           auth gate
```

## Verify

```bash
npm run typecheck       # strict TS
npm run test            # vitest (unit + RLS stubs)
```

## Roadmap
Phase 2 capture & AI gateway · Phase 3 Telegram (long-polling self-host) · Phase 4 Chief of Staff · Phase 5 health + iPhone · Phase 6 graph · Phase 7 forecasting · Phase 8 hardening, backup/restore, analytics. See the architecture doc §14.
