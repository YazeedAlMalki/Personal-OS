# Phase 6 — Graph system · build log

**Date:** 2026-06-10 · **Result:** shipped & verified.

```
next build      → ✓ (all routes incl. /graph 118kB, /api/graph, /api/entities[+/:id],
                     /api/relationships, /api/cron/graph-importance)
tsc --noEmit    → ✓ no type errors
vitest          → ✓ 175/176 (28 new graph tests, all green; the 1 failure is the
                     pre-existing eisenhower UTC-sandbox TZ test — unrelated)
SQL (pglast)    → ✓ seed.sql parses under the real Postgres grammar
```

No new migrations: `entities` / `entity_relationships` shipped in `0006_people_graph.sql`
(Phase 1), RLS in `0011`. Mention counters live in `entities.metadata` jsonb — **nothing to
re-run in the Supabase SQL editor** unless you want the new demo graph (re-run `seed.sql`).

## What was built

**1. Entity extraction in the AI gateway** (`lib/ai`)
- `AIProvider.extractEntities()` on all adapters (local Ollama / OpenAI / Anthropic / hybrid),
  validated by `ExtractedEntitySchema` before anything touches the DB (P1).
- `regexExtractEntities()` — deterministic zero-model fallback (cue verbs, company suffixes,
  place cues). `extractEntitiesWithFallback()` never throws.

**2. Pipeline step 6** (`lib/ingestion/pipeline.ts` → `lib/domains/entities.ts`)
- After every successful capture: extract → fuzzy-match existing nodes (`ilike`, exact-first)
  → bump mention counters → auto-create only at confidence ≥ 0.6 (P3: weak guesses can match,
  never spawn junk) → co-mention edges (idempotent, direction-agnostic, strength bumps on
  re-mention) → mirror person↔contact via `contacts.entity_id` → backfill
  `tasks.related_contact_id` / `opportunities.related_contact_id`/`related_company_id`.
- Wrapped in try/catch: graph enrichment can never break a capture.

**3. Importance scoring** (`lib/scoring/graph.ts`, pure + 11 tests)
- `degree_centrality·50 + linkedOpportunityValue·30 + recentMentions·20` (architecture §10);
  mention component = log volume (saturates ~20) × 14-day half-life recency decay.
- Nightly `/api/cron/graph-importance` (Bearer CRON_SECRET, per-user via service client,
  writes only changed scores). Added to `vercel.json` (09:30 UTC).

**4. API** — `GET/POST /api/entities`, `GET /api/entities/:id` (node + neighbors + contact +
linked tasks/opportunities), `GET/POST /api/relationships`, `GET /api/graph?types=…`.
Zod validation + audit rows on writes, same conventions as every other route.

**5. `/graph` page** (replaces the Placeholder)
- Cytoscape (cose force layout), node size = importance, color = entity type, edge width =
  strength; type-filter chips, search, pan/zoom.
- Click a node → side panel: type/importance/mentions, mirrored contact card (company, role,
  email, last contacted), connections (clickable → recenter), opportunities with value,
  linked tasks. **This is the "done when" gate:** click Sam Rivera → Northwind (company),
  the Acme retainer he introduced, and his linked tasks.

**6. Seed** — 5 entities (Sam Rivera, Dana Lee, Acme, Northwind, Personal OS), 5 typed edges
(works_at / introduced / knows / mentioned_with), contact mirrors, the Acme retainer linked to
Sam + Acme, and a linked task — so the gate is demoable immediately after re-running seed.sql.

## Verify it yourself (~3 min)
1. `npm run dev` (cytoscape is already in node_modules; `npm install` also works — it's in
   package.json), open **/graph**.
2. Re-run `supabase/seed.sql` if you want the demo graph.
3. Click **Sam Rivera** → see Northwind, the $50k Acme retainer, and his tasks.
4. Capture "Call Sam Rivera about the Acme renewal" in the Command Center → refresh /graph:
   mention counts bumped, edge strength up — works with zero model via the regex fallback.

## Next
Phase 7 — Forecasting surfaced on module pages (engine already exists in `lib/forecast`
with tests; needs config + per-page surfacing + insights wiring).
